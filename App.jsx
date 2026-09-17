import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, Plus, Minus, Trash2, LogOut, Settings, Package, Store, Users, Receipt, Search, ImagePlus, ArrowLeft, Printer, MessageCircle, FileText, CheckCircle2, BarChart3, UserCog, RefreshCw, Home, TrendingUp, Calendar } from 'lucide-react';
import { storage } from './storage';

const uid = () => Math.random().toString(36).slice(2, 10);
const CATEGORIES_DEFAULT = ['Porcelanato', 'Cerâmica', 'Pedras', 'Argamassa', 'Rejunte', 'Outros'];
const currency = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const clampPercent = (v) => { const n = Number(v); if (isNaN(n)) return 0; return Math.min(100, Math.max(0, n)); };

function resizeImage(file, maxW = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function itemPackagingInfo(item) {
  const pesoTotal = item.peso ? Number(item.peso) * item.qty : null;
  const embalagensNecessarias = item.qtdEmbalagem ? Math.ceil(item.qty / Number(item.qtdEmbalagem)) : null;
  const caixasNecessarias = (!item.caixaNaoSeAplica && item.qtdCaixa) ? Math.ceil(item.qty / Number(item.qtdCaixa)) : null;
  return { pesoTotal, embalagensNecessarias, caixasNecessarias, caixaNaoSeAplica: item.caixaNaoSeAplica };
}

function packagingLine(item) {
  const info = itemPackagingInfo(item);
  const parts = [];
  if (info.pesoTotal) parts.push(`Peso total: ${info.pesoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`);
  if (info.embalagensNecessarias) parts.push(`Embalagens: ${info.embalagensNecessarias}`);
  if (info.caixaNaoSeAplica) parts.push('Caixa: não se aplica');
  else if (info.caixasNecessarias) parts.push(`Caixas: ${info.caixasNecessarias}`);
  return parts.join(' · ');
}

function isWithinPeriod(isoDate, period, customFrom, customTo) {
  if (period === 'todos') return true;
  const d = new Date(isoDate);
  const now = new Date();
  if (period === 'dia') return d.toDateString() === now.toDateString();
  if (period === 'semana') {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0);
    return d >= start;
  }
  if (period === 'mes') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === 'periodo') {
    const ds = isoDate.slice(0, 10);
    if (customFrom && ds < customFrom) return false;
    if (customTo && ds > customTo) return false;
    return true;
  }
  return true;
}

function vendorRanking(storeId, orders, vendors) {
  return vendors.filter(v => v.storeId === storeId).map(v => {
    const pedidos = orders.filter(o => o.vendorId === v.id && o.storeId === storeId && o.status === 'pedido');
    const total = pedidos.reduce((s, o) => s + (Number(o.total) || 0), 0);
    return { id: v.id, name: v.name, total, count: pedidos.length };
  }).sort((a, b) => b.total - a.total);
}

async function shareOrDownloadPdf(doc, filename) {
  try {
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  doc.save(filename);
  return 'downloaded';
}

function ReportPdfButtons({ pdfLibReady, buildDoc, filename }) {
  const [status, setStatus] = useState('');
  const handleDownload = () => { const doc = buildDoc(); doc.save(filename); };
  const handleShare = async () => {
    const doc = buildDoc();
    const result = await shareOrDownloadPdf(doc, filename);
    setStatus(result === 'downloaded' ? 'Seu aparelho não suporta compartilhar direto — o PDF foi baixado.' : '');
  };
  return (
    <div className="pdf-actions">
      <button className="btn-secondary" disabled={!pdfLibReady} onClick={handleDownload}>
        <Printer size={16} /> {pdfLibReady ? 'Baixar PDF' : 'Preparando gerador de PDF…'}
      </button>
      <button className="btn-whatsapp" disabled={!pdfLibReady} onClick={handleShare}>
        <MessageCircle size={16} /> Compartilhar por WhatsApp
      </button>
      {status && <p className="hint">{status}</p>}
    </div>
  );
}

const STORAGE_KEYS = { stores: 'stores', vendors: 'vendors', representantes: 'representantes', products: 'products', orders: 'orders', adminPin: 'adminPin' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [pdfLibReady, setPdfLibReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [representantes, setRepresentantes] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [adminPin, setAdminPin] = useState('1234');

  const [screen, setScreen] = useState('login');
  const [loginTab, setLoginTab] = useState('vendor');
  const [loginStoreId, setLoginStoreId] = useState('');
  const [loginVendorId, setLoginVendorId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginRepId, setLoginRepId] = useState('');
  const [loginRepPin, setLoginRepPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminPinInput, setAdminPinInput] = useState('');

  const [currentVendor, setCurrentVendor] = useState(null);
  const [currentRepresentante, setCurrentRepresentante] = useState(null);
  const [cart, setCart] = useState([]);
  const [qtyPromptProductId, setQtyPromptProductId] = useState(null);
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [checkout, setCheckout] = useState({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' });
  const [lastOrder, setLastOrder] = useState(null);
  const [adminTab, setAdminTab] = useState('produtos');

  const loadKey = async (key, fallback) => {
    try {
      const r = await storage.get(key);
      return r ? JSON.parse(r.value) : fallback;
    } catch { return fallback; }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    const [s, v, rep, p, o, pin] = await Promise.all([
      loadKey(STORAGE_KEYS.stores, []), loadKey(STORAGE_KEYS.vendors, []), loadKey(STORAGE_KEYS.representantes, []),
      loadKey(STORAGE_KEYS.products, []), loadKey(STORAGE_KEYS.orders, []), loadKey(STORAGE_KEYS.adminPin, '1234'),
    ]);
    setStores(s); setVendors(v); setRepresentantes(rep); setProducts(p); setOrders(o); setAdminPin(pin);
    setRefreshing(false);
    return { s, v, rep, p, o, pin };
  };

  useEffect(() => {
    if (window.jspdf) { setPdfLibReady(true); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.async = true;
    script.onload = () => setPdfLibReady(true);
    script.onerror = () => setPdfLibReady(false);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    (async () => { await refreshAll(); setReady(true); })();
  }, []);

  useEffect(() => {
    if (ready && (screen === 'admin' || screen === 'repDashboard')) { refreshAll(); }
  }, [screen]);

  const mutate = async (key, updater, setter) => {
    let current;
    try {
      const r = await storage.get(key);
      current = r ? JSON.parse(r.value) : [];
    } catch { current = []; }
    const next = updater(current);
    setter(next);
    try { await storage.set(key, JSON.stringify(next)); } catch (e) { console.error(e); }
    return next;
  };

  const mutateStores = (updater) => mutate(STORAGE_KEYS.stores, updater, setStores);
  const mutateVendors = (updater) => mutate(STORAGE_KEYS.vendors, updater, setVendors);
  const mutateRepresentantes = (updater) => mutate(STORAGE_KEYS.representantes, updater, setRepresentantes);
  const mutateProducts = (updater) => mutate(STORAGE_KEYS.products, updater, setProducts);
  const mutateOrders = (updater) => mutate(STORAGE_KEYS.orders, updater, setOrders);
  const mutateAdminPin = (pin) => { setAdminPin(pin); storage.set(STORAGE_KEYS.adminPin, JSON.stringify(pin)).catch(() => {}); };

  const storeVendors = useMemo(() => vendors.filter(v => v.storeId === loginStoreId), [vendors, loginStoreId]);

  const doVendorLogin = async () => {
    const { v } = await refreshAll();
    const vendor = v.find(x => x.id === loginVendorId);
    if (!vendor) { setLoginError('Selecione um vendedor.'); return; }
    if ((vendor.pin || '') !== loginPin) { setLoginError('PIN incorreto.'); return; }
    setCurrentVendor(vendor); setCart([]); setLoginError(''); setScreen('catalog');
  };
  const doRepresentanteLogin = async () => {
    const { rep } = await refreshAll();
    const r = rep.find(x => x.id === loginRepId);
    if (!r) { setLoginError('Selecione um representante.'); return; }
    if ((r.pin || '') !== loginRepPin) { setLoginError('PIN incorreto.'); return; }
    setCurrentRepresentante(r); setLoginError(''); setScreen('repDashboard');
  };
  const doAdminLogin = () => {
    if (adminPinInput === adminPin) { setScreen('admin'); setLoginError(''); }
    else { setLoginError('PIN de administrador incorreto.'); }
  };
  const logout = () => {
    setCurrentVendor(null); setCurrentRepresentante(null); setCart([]); setScreen('login');
    setLoginStoreId(''); setLoginVendorId(''); setLoginPin(''); setLoginRepId(''); setLoginRepPin('');
  };

  const confirmQuantity = (productId, qty) => {
    setCart(prev => {
      if (qty <= 0) return prev.filter(i => i.productId !== productId);
      const existing = prev.find(i => i.productId === productId);
      if (existing) return prev.map(i => i.productId === productId ? { ...i, qty } : i);
      return [...prev, { productId, qty, discountPercent: 0 }];
    });
    setQtyPromptProductId(null);
  };
  const setItemDiscount = (productId, value) => {
    setCart(prev => prev.map(i => i.productId === productId ? { ...i, discountPercent: value } : i));
  };
  const removeFromCart = (productId) => setCart(prev => prev.filter(i => i.productId !== productId));

  const currentStore = currentVendor ? stores.find(s => s.id === currentVendor.storeId) : null;
  const descontoRevendaPercent = currentStore?.modalidade === 'revenda' ? clampPercent(currentStore.descontoRevenda) : 0;

  const cartDetailed = cart.map(i => {
    const p = products.find(pr => pr.id === i.productId);
    if (!p) return null;
    const discPercent = clampPercent(i.discountPercent);
    const lineTotal = p.price * i.qty * (1 - discPercent / 100);
    return { ...i, product: p, discPercent, lineTotal };
  }).filter(Boolean);
  const cartSubtotal = cartDetailed.reduce((sum, i) => sum + i.lineTotal, 0);
  const cartCount = cart.length;
  const afterResale = cartSubtotal * (1 - descontoRevendaPercent / 100);
  const generalDiscountPercent = clampPercent(checkout.descontoGeral);
  const cartTotal = afterResale * (1 - generalDiscountPercent / 100);

  const salvarOrcamento = async () => {
    if (!checkout.nome.trim()) return;
    const store = stores.find(s => s.id === currentVendor.storeId);
    const representante = store?.representanteId ? representantes.find(r => r.id === store.representanteId) : null;
    const repPercent = store?.representanteCommissionPercent || 0;
    const commissionStoreValue = cartTotal * ((store?.commissionPercent || 0) / 100);
    const commissionVendorValue = cartTotal * ((currentVendor?.commissionPercent || 0) / 100);
    const commissionRepresentanteValue = representante ? cartTotal * (repPercent / 100) : 0;
    const order = {
      id: uid(), createdAt: new Date().toISOString(),
      vendorId: currentVendor.id, vendorName: currentVendor.name,
      storeId: currentVendor.storeId, storeName: store?.name || '',
      representanteId: representante?.id || null,
      representanteName: representante?.name || null,
      representanteCommissionPercent: repPercent,
      cliente: { ...checkout },
      items: cartDetailed.map(i => ({
        productId: i.product.id, name: i.product.name, price: i.product.price, qty: i.qty, discountPercent: i.discPercent,
        peso: i.product.peso || null, tamanho: i.product.tamanho || null,
        qtdEmbalagem: i.product.qtdEmbalagem || null, qtdCaixa: i.product.qtdCaixa || null, caixaNaoSeAplica: !!i.product.caixaNaoSeAplica,
      })),
      subtotal: cartSubtotal,
      descontoRevendaPercent,
      generalDiscountPercent,
      total: cartTotal,
      commissionStorePercent: store?.commissionPercent || 0,
      commissionVendorPercent: currentVendor?.commissionPercent || 0,
      commissionStoreValue, commissionVendorValue, commissionRepresentanteValue,
      status: 'orcamento',
      convertedAt: null,
    };
    await mutateOrders(current => [order, ...current]);
    setLastOrder(order); setCart([]); setCheckout({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' });
    setScreen('orderSummary');
  };

  const convertToPedido = async (orderId) => {
    const now = new Date().toISOString();
    const next = await mutateOrders(current => current.map(o => o.id === orderId ? { ...o, status: 'pedido', convertedAt: now } : o));
    if (lastOrder && lastOrder.id === orderId) {
      const updated = next.find(o => o.id === orderId);
      if (updated) setLastOrder(updated);
    }
  };

  const generatePDF = (order) => {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;
    const titulo = order.status === 'pedido' ? 'Pedido' : 'Orçamento';
    doc.setFontSize(16);
    doc.text(`${titulo} - ${order.storeName}`, 14, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Vendedor: ${order.vendorName}`, 14, y); y += 6;
    doc.text(`Data: ${new Date(order.createdAt).toLocaleString('pt-BR')}`, 14, y); y += 10;
    doc.text(`Cliente: ${order.cliente.nome}`, 14, y); y += 6;
    if (order.cliente.telefone) { doc.text(`Telefone: ${order.cliente.telefone}`, 14, y); y += 6; }
    if (order.cliente.endereco) { doc.text(`Endereço: ${order.cliente.endereco}`, 14, y); y += 6; }
    y += 4;
    doc.setFontSize(11);
    doc.text('Produto', 14, y); doc.text('Qtd', 108, y); doc.text('Desc.', 128, y); doc.text('Preço', 145, y); doc.text('Subtotal', 170, y);
    y += 2;
    doc.line(14, y, 196, y); y += 6;
    doc.setFontSize(10);
    order.items.forEach(i => {
      const lineTotal = i.price * i.qty * (1 - (i.discountPercent || 0) / 100);
      doc.text(String(i.name).slice(0, 38), 14, y);
      doc.text(String(i.qty), 108, y);
      doc.text(`${i.discountPercent || 0}%`, 128, y);
      doc.text(currency(i.price), 145, y);
      doc.text(currency(lineTotal), 170, y);
      y += 6;
      const pkg = packagingLine(i);
      if (pkg) {
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(pkg, 14, y);
        doc.setTextColor(0);
        doc.setFontSize(10);
        y += 6;
      } else { y += 1; }
      if (y > 265) { doc.addPage(); y = 20; }
    });
    y += 2;
    doc.line(14, y, 196, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Subtotal: ${currency(order.subtotal)}`, 140, y); y += 6;
    if (order.descontoRevendaPercent) { doc.text(`Desconto revenda: ${order.descontoRevendaPercent}%`, 140, y); y += 6; }
    if (order.generalDiscountPercent) { doc.text(`Desconto geral: ${order.generalDiscountPercent}%`, 140, y); y += 6; }
    doc.setFontSize(13);
    doc.text(`Total: ${currency(order.total)}`, 140, y);
    if (order.cliente.obs) { y += 10; doc.setFontSize(10); doc.text(`Obs: ${order.cliente.obs}`, 14, y); }
    doc.save(`${titulo.toLowerCase()}-${(order.cliente.nome || 'cliente').replace(/\s+/g, '-').toLowerCase()}.pdf`);
  };

  const waLink = (order) => {
    const titulo = order.status === 'pedido' ? 'Pedido' : 'Orçamento';
    const lines = [
      `*${titulo} - ${order.storeName}*`,
      `Vendedor: ${order.vendorName}`,
      `Cliente: ${order.cliente.nome}${order.cliente.telefone ? ' - ' + order.cliente.telefone : ''}`,
      order.cliente.endereco ? `Endereço: ${order.cliente.endereco}` : null,
      '',
      ...order.items.map(i => {
        const lineTotal = i.price * i.qty * (1 - (i.discountPercent || 0) / 100);
        const descTxt = i.discountPercent ? ` (desc. ${i.discountPercent}%)` : '';
        const pkg = packagingLine(i);
        return `${i.qty}x ${i.name}${descTxt} - ${currency(lineTotal)}${pkg ? ' [' + pkg + ']' : ''}`;
      }),
      '',
      order.descontoRevendaPercent ? `Desconto revenda: ${order.descontoRevendaPercent}%` : null,
      order.generalDiscountPercent ? `Desconto geral: ${order.generalDiscountPercent}%` : null,
      `*Total: ${currency(order.total)}*`,
      order.cliente.obs ? `Obs: ${order.cliente.obs}` : null,
    ].filter(Boolean).join('\n');
    return `https://wa.me/?text=${encodeURIComponent(lines)}`;
  };

  if (!ready) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Carregando…</div>;

  const productForQtyPrompt = qtyPromptProductId ? products.find(p => p.id === qtyPromptProductId) : null;
  const existingQtyForPrompt = qtyPromptProductId ? (cart.find(i => i.productId === qtyPromptProductId)?.qty || 1) : 1;

  return (
    <div className="app-root">
      <style>{STYLES}</style>
      {screen === 'login' && (
        <LoginScreen {...{ loginTab, setLoginTab, stores, storeVendors, loginStoreId, setLoginStoreId, loginVendorId, setLoginVendorId, loginPin, setLoginPin, doVendorLogin, representantes, loginRepId, setLoginRepId, loginRepPin, setLoginRepPin, doRepresentanteLogin, adminPinInput, setAdminPinInput, doAdminLogin, loginError }} />
      )}
      {screen === 'catalog' && currentVendor && (
        <>
          <CatalogScreen {...{ currentVendor, stores, products, activeCategory, setActiveCategory, search, setSearch, onAddClick: setQtyPromptProductId, cartCount, cartTotal, setScreen, logout, refreshAll, refreshing }} />
          {productForQtyPrompt && (
            <QuantityModal product={productForQtyPrompt} initialQty={existingQtyForPrompt} onConfirm={(qty) => confirmQuantity(productForQtyPrompt.id, qty)} onClose={() => setQtyPromptProductId(null)} />
          )}
        </>
      )}
      {screen === 'cart' && (
        <CartScreen {...{ cartDetailed, setQty: (id, qty) => confirmQuantity(id, qty), setItemDiscount, removeFromCart, cartSubtotal, setScreen }} />
      )}
      {screen === 'checkout' && (
        <CheckoutScreen {...{ checkout, setCheckout, cartSubtotal, descontoRevendaPercent, afterResale, generalDiscountPercent, cartTotal, salvarOrcamento, setScreen }} />
      )}
      {screen === 'orderSummary' && lastOrder && (
        <OrderSummaryScreen {...{ order: lastOrder, waLink, setScreen, generatePDF, pdfLibReady, convertToPedido }} />
      )}
      {screen === 'quotes' && currentVendor && (
        <QuotesScreen {...{ orders: orders.filter(o => o.vendorId === currentVendor.id), convertToPedido, setScreen }} />
      )}
      {screen === 'myReport' && currentVendor && (
        <MyReportScreen {...{ orders: orders.filter(o => o.vendorId === currentVendor.id), setScreen, pdfLibReady }} />
      )}
      {screen === 'repDashboard' && currentRepresentante && (
        <RepresentanteScreen {...{ currentRepresentante, stores, vendors, orders, logout, refreshAll, refreshing, pdfLibReady }} />
      )}
      {screen === 'admin' && (
        <AdminScreen {...{ stores, vendors, representantes, products, orders, updateStores: mutateStores, updateVendors: mutateVendors, updateRepresentantes: mutateRepresentantes, updateProducts: mutateProducts, adminTab, setAdminTab, adminPin, updateAdminPin: mutateAdminPin, setScreen, pdfLibReady, convertToPedido, refreshAll, refreshing }} />
      )}
    </div>
  );
}

function QuantityModal({ product, initialQty, onConfirm, onClose }) {
  const [qty, setQty] = useState(String(initialQty || 1));
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const confirm = () => { const n = Math.max(0, parseInt(qty, 10) || 0); onConfirm(n); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{product.name}</div>
        <div className="modal-sub">{currency(product.price)} / un.</div>
        <input ref={inputRef} type="number" inputMode="numeric" min="0" className="modal-qty-input" value={qty}
          onChange={e => setQty(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); }} />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={confirm}>Adicionar</button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ loginTab, setLoginTab, stores, storeVendors, loginStoreId, setLoginStoreId, loginVendorId, setLoginVendorId, loginPin, setLoginPin, doVendorLogin, representantes, loginRepId, setLoginRepId, loginRepPin, setLoginRepPin, doRepresentanteLogin, adminPinInput, setAdminPinInput, doAdminLogin, loginError }) {
  return (
    <div className="screen-center">
      <div className="login-card">
        <div className="login-header">
          <div className="tile-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          <h1>Catálogo de Revestimentos</h1>
          <p>Acesso para consultores de vendas</p>
        </div>
        <div className="tabs">
          <button className={loginTab === 'vendor' ? 'tab active' : 'tab'} onClick={() => setLoginTab('vendor')}>Vendedor</button>
          <button className={loginTab === 'rep' ? 'tab active' : 'tab'} onClick={() => setLoginTab('rep')}>Representante</button>
          <button className={loginTab === 'admin' ? 'tab active' : 'tab'} onClick={() => setLoginTab('admin')}>Administração</button>
        </div>
        {loginTab === 'vendor' && (
          <div className="form-stack">
            <label>Loja
              <select value={loginStoreId} onChange={e => { setLoginStoreId(e.target.value); setLoginVendorId(''); }}>
                <option value="">Selecione a loja</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Vendedor
              <select value={loginVendorId} onChange={e => setLoginVendorId(e.target.value)} disabled={!loginStoreId}>
                <option value="">Selecione o vendedor</option>
                {storeVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label>PIN
              <input type="password" inputMode="numeric" maxLength={6} value={loginPin} onChange={e => setLoginPin(e.target.value)} placeholder="••••" />
            </label>
            {loginError && <div className="error">{loginError}</div>}
            <button className="btn-primary" onClick={doVendorLogin}>Entrar</button>
            {stores.length === 0 && <p className="hint">Nenhuma loja cadastrada ainda. Peça ao administrador para configurar o catálogo.</p>}
          </div>
        )}
        {loginTab === 'rep' && (
          <div className="form-stack">
            <label>Representante
              <select value={loginRepId} onChange={e => setLoginRepId(e.target.value)}>
                <option value="">Selecione seu nome</option>
                {representantes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label>PIN
              <input type="password" inputMode="numeric" maxLength={6} value={loginRepPin} onChange={e => setLoginRepPin(e.target.value)} placeholder="••••" />
            </label>
            {loginError && <div className="error">{loginError}</div>}
            <button className="btn-primary" onClick={doRepresentanteLogin}>Entrar</button>
          </div>
        )}
        {loginTab === 'admin' && (
          <div className="form-stack">
            <label>PIN de administrador
              <input type="password" inputMode="numeric" value={adminPinInput} onChange={e => setAdminPinInput(e.target.value)} placeholder="••••" />
            </label>
            {loginError && <div className="error">{loginError}</div>}
            <button className="btn-primary" onClick={doAdminLogin}>Entrar como administrador</button>
            <p className="hint">PIN padrão: 1234 (altere depois em Configurações).</p>
          </div>
        )}
      </div>
    </div>
  );
}

function productSpecsLine(p) {
  const parts = [];
  if (p.tamanho) parts.push(p.tamanho);
  if (p.peso) parts.push(`${p.peso} kg`);
  if (p.caixaNaoSeAplica) parts.push('Caixa: não se aplica');
  else if (p.qtdCaixa) parts.push(`${p.qtdCaixa}/cx`);
  if (p.qtdEmbalagem) parts.push(`${p.qtdEmbalagem}/emb.`);
  return parts.join(' · ');
}

function CatalogScreen({ currentVendor, stores, products, activeCategory, setActiveCategory, search, setSearch, onAddClick, cartCount, cartTotal, setScreen, logout, refreshAll, refreshing }) {
  const store = stores.find(s => s.id === currentVendor.storeId);
  const categories = ['Todos', ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];
  const filtered = products.filter(p => p.active !== false)
    .filter(p => activeCategory === 'Todos' || p.category === activeCategory)
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="screen">
      <header className="topbar">
        <div><div className="topbar-title">{store?.name}</div><div className="topbar-sub">{currentVendor.name}</div></div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={refreshAll} title="Atualizar catálogo" disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'spin' : ''} /></button>
          <button className="icon-btn" onClick={() => setScreen('myReport')} title="Meu relatório de vendas"><BarChart3 size={18} /></button>
          <button className="icon-btn" onClick={() => setScreen('quotes')} title="Meus orçamentos"><FileText size={18} /></button>
          <button className="icon-btn" onClick={logout} title="Sair"><LogOut size={18} /></button>
          <button className="cart-btn" onClick={() => setScreen('cart')}>
            <ShoppingCart size={18} />
            {cartCount > 0 && <span className="badge">{cartCount}</span>}
          </button>
        </div>
      </header>
      <div className="search-row">
        <Search size={16} />
        <input placeholder="Buscar produto…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="chip-row">
        {categories.map(c => (
          <button key={c} className={activeCategory === c ? 'chip active' : 'chip'} onClick={() => setActiveCategory(c)}>{c}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><Package size={28} /><p>Nenhum produto encontrado.</p></div>
      ) : (
        <div className="product-grid">
          {filtered.map(p => (
            <div key={p.id} className="product-card">
              <div className="product-photo">{p.photo ? <img src={p.photo} alt={p.name} /> : <div className="photo-placeholder"><Package size={22} /></div>}</div>
              <div className="product-info">
                <div className="product-name">{p.name}</div>
                <div className="product-category">{p.category}</div>
                {productSpecsLine(p) && <div className="product-specs">{productSpecsLine(p)}</div>}
                <div className="product-price">{currency(p.price)}</div>
              </div>
              <button className="add-btn" onClick={() => onAddClick(p.id)}><Plus size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {cartCount > 0 && (
        <div className="floating-cart" onClick={() => setScreen('cart')}>
          <span>{cartCount} item{cartCount > 1 ? 's' : ''} diferente{cartCount > 1 ? 's' : ''} no carrinho</span>
          <strong>{currency(cartTotal)}</strong>
        </div>
      )}
    </div>
  );
}

function CartScreen({ cartDetailed, setQty, setItemDiscount, removeFromCart, cartSubtotal, setScreen }) {
  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        </div>
        <div className="topbar-title">Carrinho</div>
        <div style={{ width: 34 }} />
      </header>
      {cartDetailed.length === 0 ? (
        <div className="empty-state">
          <ShoppingCart size={28} /><p>Seu carrinho está vazio.</p>
          <button className="btn-secondary" onClick={() => setScreen('catalog')}>Voltar ao catálogo</button>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {cartDetailed.map(i => (
              <div key={i.productId} className="cart-item">
                <div className="cart-item-photo">{i.product.photo ? <img src={i.product.photo} alt="" /> : <Package size={18} />}</div>
                <div className="cart-item-info">
                  <div className="cart-item-name">{i.product.name}</div>
                  <div className="cart-item-price">{currency(i.product.price)} / un. {i.discPercent > 0 && <span className="disc-tag">-{i.discPercent}%</span>}</div>
                  <div className="disc-row">
                    <span>Desc. %</span>
                    <input type="number" min="0" max="100" className="disc-input" value={i.discountPercent} onChange={e => setItemDiscount(i.productId, e.target.value)} />
                  </div>
                </div>
                <div className="qty-control">
                  <button onClick={() => setQty(i.productId, i.qty - 1)}><Minus size={14} /></button>
                  <span onClick={() => setQty(i.productId, i.qty)}>{i.qty}</span>
                  <button onClick={() => setQty(i.productId, i.qty + 1)}><Plus size={14} /></button>
                </div>
                <button className="icon-btn" onClick={() => removeFromCart(i.productId)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <div className="cart-summary">
            <div className="cart-total-row"><span>Subtotal</span><strong>{currency(cartSubtotal)}</strong></div>
            <button className="btn-primary" onClick={() => setScreen('checkout')}>Finalizar orçamento</button>
          </div>
        </>
      )}
    </div>
  );
}

function CheckoutScreen({ checkout, setCheckout, cartSubtotal, descontoRevendaPercent, afterResale, generalDiscountPercent, cartTotal, salvarOrcamento, setScreen }) {
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">Dados do cliente</div>
        <button className="icon-btn" onClick={() => setScreen('cart')}><ArrowLeft size={18} /></button>
      </header>
      <div className="form-stack pad">
        <label>Nome do cliente *
          <input value={checkout.nome} onChange={e => setCheckout({ ...checkout, nome: e.target.value })} placeholder="Nome completo" />
        </label>
        <label>Telefone / WhatsApp
          <input value={checkout.telefone} onChange={e => setCheckout({ ...checkout, telefone: e.target.value })} placeholder="(00) 00000-0000" />
        </label>
        <label>Endereço de entrega
          <input value={checkout.endereco} onChange={e => setCheckout({ ...checkout, endereco: e.target.value })} placeholder="Opcional" />
        </label>
        <label>Desconto geral (%)
          <input type="number" min="0" max="100" value={checkout.descontoGeral} onChange={e => setCheckout({ ...checkout, descontoGeral: e.target.value })} placeholder="0" />
        </label>
        <label>Observações
          <textarea rows={3} value={checkout.obs} onChange={e => setCheckout({ ...checkout, obs: e.target.value })} placeholder="Opcional" />
        </label>
        <div className="cart-total-row"><span>Subtotal</span><span>{currency(cartSubtotal)}</span></div>
        {descontoRevendaPercent > 0 && <div className="cart-total-row muted-row"><span>Desconto de revenda ({descontoRevendaPercent}%) — automático</span><span>- {currency(cartSubtotal - afterResale)}</span></div>}
        {generalDiscountPercent > 0 && <div className="cart-total-row muted-row"><span>Desconto geral ({generalDiscountPercent}%)</span><span>- {currency(afterResale - cartTotal)}</span></div>}
        <div className="cart-total-row"><span>Total do orçamento</span><strong>{currency(cartTotal)}</strong></div>
        <button className="btn-primary" disabled={!checkout.nome.trim()} onClick={salvarOrcamento}>Salvar orçamento</button>
      </div>
    </div>
  );
}

function OrderSummaryScreen({ order, waLink, setScreen, generatePDF, pdfLibReady, convertToPedido }) {
  const isPedido = order.status === 'pedido';
  return (
    <div className="screen">
      <header className="topbar no-print">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">{isPedido ? 'Pedido confirmado' : 'Orçamento salvo'}</div>
        <div style={{ width: 34 }} />
      </header>
      <div className="printable">
        <div className={isPedido ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{isPedido ? 'Pedido' : 'Orçamento'}</div>
        <h2>{isPedido ? 'Pedido' : 'Orçamento'} — {order.storeName}</h2>
        <p className="muted">Vendedor: {order.vendorName} · {new Date(order.createdAt).toLocaleString('pt-BR')}</p>
        <div className="divider" />
        <p><strong>Cliente:</strong> {order.cliente.nome}</p>
        {order.cliente.telefone && <p><strong>Telefone:</strong> {order.cliente.telefone}</p>}
        {order.cliente.endereco && <p><strong>Endereço:</strong> {order.cliente.endereco}</p>}
        <div className="divider" />
        <table className="order-table">
          <thead><tr><th>Produto</th><th>Qtd</th><th>Desc.</th><th>Subtotal</th></tr></thead>
          <tbody>
            {order.items.map(i => {
              const lineTotal = i.price * i.qty * (1 - (i.discountPercent || 0) / 100);
              const pkg = packagingLine(i);
              return (
                <React.Fragment key={i.productId}>
                  <tr><td>{i.name}</td><td>{i.qty}</td><td>{i.discountPercent || 0}%</td><td>{currency(lineTotal)}</td></tr>
                  {pkg && <tr className="spec-row"><td colSpan={4}>{pkg}</td></tr>}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {order.descontoRevendaPercent > 0 && <p className="muted">Desconto de revenda: {order.descontoRevendaPercent}%</p>}
        {order.generalDiscountPercent > 0 && <p className="muted">Desconto geral: {order.generalDiscountPercent}%</p>}
        <div className="order-total">Total: {currency(order.total)}</div>
        {order.cliente.obs && <p><strong>Obs:</strong> {order.cliente.obs}</p>}
      </div>
      <div className="form-stack pad no-print">
        {!isPedido && (
          <button className="btn-secondary" onClick={() => convertToPedido(order.id)}><CheckCircle2 size={16} /> Converter em pedido agora</button>
        )}
        <button className="btn-secondary" disabled={!pdfLibReady} onClick={() => generatePDF(order)}>
          <Printer size={16} /> {pdfLibReady ? 'Baixar PDF' : 'Preparando gerador de PDF…'}
        </button>
        <a className="btn-whatsapp" href={waLink(order)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Enviar por WhatsApp</a>
        <button className="btn-primary" onClick={() => setScreen('catalog')}>Novo orçamento</button>
      </div>
    </div>
  );
}

function QuotesScreen({ orders, convertToPedido, setScreen }) {
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">Meus orçamentos</div>
        <div style={{ width: 34 }} />
      </header>
      <div className="admin-list pad">
        {sorted.map(o => (
          <div key={o.id} className="order-row">
            <div>
              <div><strong>{o.cliente.nome}</strong></div>
              <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')} · {currency(o.total)}</div>
              <span className={o.status === 'pedido' ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{o.status === 'pedido' ? 'Pedido' : 'Orçamento'}</span>
            </div>
            {o.status === 'orcamento' && (
              <button className="btn-secondary small" onClick={() => convertToPedido(o.id)}><CheckCircle2 size={14} /> Converter</button>
            )}
          </div>
        ))}
        {sorted.length === 0 && <p className="hint">Você ainda não tem orçamentos salvos.</p>}
      </div>
    </div>
  );
}

function PeriodFilter({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }) {
  return (
    <div className="period-filter">
      <div className="chip-row" style={{ padding: 0 }}>
        {[['dia', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês atual'], ['periodo', 'Período'], ['todos', 'Tudo']].map(([key, label]) => (
          <button key={key} className={period === key ? 'chip active' : 'chip'} onClick={() => setPeriod(key)}>{label}</button>
        ))}
      </div>
      {period === 'periodo' && (
        <div className="admin-form-actions" style={{ gap: 12, marginTop: 10 }}>
          <label style={{ flex: 1 }}>De
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>Até
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

function MyReportScreen({ orders, setScreen, pdfLibReady }) {
  const [period, setPeriod] = useState('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = orders.filter(o => isWithinPeriod(o.createdAt, period, customFrom, customTo) && (!statusFilter || o.status === statusFilter))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const orcamentos = filtered.filter(o => o.status === 'orcamento');
  const pedidos = filtered.filter(o => o.status === 'pedido');
  const totalOrcamentos = orcamentos.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalPedidos = pedidos.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalComissao = pedidos.reduce((s, o) => s + (Number(o.commissionVendorValue) || 0), 0);

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(15);
    doc.text('Meu relatório de vendas', 14, y); y += 8;
    doc.setFontSize(9);
    doc.text(`Orçamentos: ${orcamentos.length} (${currency(totalOrcamentos)}) · Pedidos: ${pedidos.length} (${currency(totalPedidos)})`, 14, y); y += 10;
    doc.setFontSize(10);
    doc.text('Data', 14, y); doc.text('Cliente', 45, y); doc.text('Status', 110, y); doc.text('Total', 140, y); doc.text('Comissão', 170, y);
    y += 2; doc.line(14, y, 196, y); y += 6;
    filtered.forEach(o => {
      doc.text(new Date(o.createdAt).toLocaleDateString('pt-BR'), 14, y);
      doc.text(String(o.cliente.nome).slice(0, 28), 45, y);
      doc.text(o.status === 'pedido' ? 'Pedido' : 'Orçam.', 110, y);
      doc.text(currency(o.total), 140, y);
      doc.text(o.status === 'pedido' ? currency(o.commissionVendorValue) : '—', 170, y);
      y += 7;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 4; doc.line(14, y, 196, y); y += 8;
    doc.setFontSize(11);
    doc.text(`Total em vendas: ${currency(totalOrcamentos + totalPedidos)}`, 14, y); y += 6;
    doc.text(`Total de comissão: ${currency(totalComissao)}`, 14, y);
    return doc;
  };

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">Meu relatório de vendas</div>
        <div style={{ width: 34 }} />
      </header>
      <div className="form-stack pad">
        <PeriodFilter {...{ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }} />
        <label>Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos (orçamentos e pedidos)</option>
            <option value="orcamento">Só orçamentos</option>
            <option value="pedido">Só pedidos</option>
          </select>
        </label>

        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Orçamentos</div><div className="stat-value">{orcamentos.length} · {currency(totalOrcamentos)}</div></div>
          <div className="stat-card"><div className="stat-label">Pedidos</div><div className="stat-value">{pedidos.length} · {currency(totalPedidos)}</div></div>
          <div className="stat-card"><div className="stat-label">Minha comissão</div><div className="stat-value">{currency(totalComissao)}</div></div>
        </div>

        <div className="admin-list">
          {filtered.map(o => (
            <div key={o.id} className="order-row">
              <div>
                <div><strong>{o.cliente.nome}</strong></div>
                <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
                <span className={o.status === 'pedido' ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{o.status === 'pedido' ? 'Pedido' : 'Orçamento'}</span>
              </div>
              <div className="order-row-values">
                <span>{currency(o.total)}</span>
                {o.status === 'pedido' && <span className="muted">Comissão: {currency(o.commissionVendorValue)}</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="hint">Nenhum registro nesse período.</p>}
        </div>
        {filtered.length > 0 && (
          <div className="stat-card total-footer">
            <strong>Total do período:</strong> {currency(totalOrcamentos + totalPedidos)} em vendas · {currency(totalComissao)} de comissão
          </div>
        )}
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="meu-relatorio-vendas.pdf" />
      </div>
    </div>
  );
}

function RepresentanteScreen({ currentRepresentante, stores, vendors, orders, logout, refreshAll, refreshing, pdfLibReady }) {
  const [period, setPeriod] = useState('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [expandedStoreId, setExpandedStoreId] = useState(null);

  const myStores = stores.filter(s => s.representanteId === currentRepresentante.id);
  const myStoreIds = myStores.map(s => s.id);
  const filtered = orders.filter(o => myStoreIds.includes(o.storeId) && isWithinPeriod(o.createdAt, period, customFrom, customTo) && (!statusFilter || o.status === statusFilter));
  const detailedFiltered = filtered.filter(o => !storeFilter || o.storeId === storeFilter).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pedidosGeral = filtered.filter(o => o.status === 'pedido');
  const totalComissaoGeral = pedidosGeral.reduce((s, o) => s + (Number(o.commissionRepresentanteValue) || 0), 0);

  const porLoja = myStores.map(s => {
    const os = filtered.filter(o => o.storeId === s.id);
    const pedidos = os.filter(o => o.status === 'pedido');
    const orcCount = os.filter(o => o.status === 'orcamento').length;
    const orcValue = os.filter(o => o.status === 'orcamento').reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const pedValue = pedidos.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const comissao = pedidos.reduce((sum, o) => sum + (Number(o.commissionRepresentanteValue) || 0), 0);
    return { id: s.id, name: s.name, orcCount, orcValue, pedCount: pedidos.length, pedValue, comissao };
  });
  const totalOrcCount = porLoja.reduce((s, l) => s + l.orcCount, 0);
  const totalOrcValue = porLoja.reduce((s, l) => s + l.orcValue, 0);
  const totalPedCount = porLoja.reduce((s, l) => s + l.pedCount, 0);
  const totalPedValue = porLoja.reduce((s, l) => s + l.pedValue, 0);

  const detFaturamento = detailedFiltered.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const detComissaoLoja = detailedFiltered.filter(o => o.status === 'pedido').reduce((s, o) => s + (Number(o.commissionStoreValue) || 0), 0);
  const detComissaoRep = detailedFiltered.filter(o => o.status === 'pedido').reduce((s, o) => s + (Number(o.commissionRepresentanteValue) || 0), 0);

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(15);
    doc.text('Relatório do representante', 14, y); y += 8;
    doc.setFontSize(9);
    const storeLabel = storeFilter ? (myStores.find(s => s.id === storeFilter)?.name || '') : 'Todas as lojas';
    doc.text(`Representante: ${currentRepresentante.name} · Loja: ${storeLabel}`, 14, y); y += 10;
    doc.setFontSize(10);
    doc.text('Data', 14, y); doc.text('Loja', 40, y); doc.text('Cliente', 80, y); doc.text('Status', 118, y); doc.text('Total', 140, y); doc.text('C.loja', 160, y); doc.text('C.repr.', 178, y);
    y += 2; doc.line(14, y, 196, y); y += 6;
    detailedFiltered.forEach(o => {
      doc.text(new Date(o.createdAt).toLocaleDateString('pt-BR'), 14, y);
      doc.text(String(o.storeName).slice(0, 16), 40, y);
      doc.text(String(o.cliente.nome).slice(0, 14), 80, y);
      doc.text(o.status === 'pedido' ? 'Pedido' : 'Orçam.', 118, y);
      doc.text(currency(o.total), 140, y);
      doc.text(o.status === 'pedido' ? currency(o.commissionStoreValue) : '—', 160, y);
      doc.text(o.status === 'pedido' ? currency(o.commissionRepresentanteValue) : '—', 178, y);
      y += 7;
      if (y > 265) { doc.addPage(); y = 20; }
    });
    y += 4; doc.line(14, y, 196, y); y += 8;
    doc.setFontSize(11);
    doc.text(`Faturamento total: ${currency(detFaturamento)}`, 14, y); y += 6;
    doc.text(`Comissão da loja: ${currency(detComissaoLoja)}`, 14, y); y += 6;
    doc.text(`Comissão do representante: ${currency(detComissaoRep)}`, 14, y);
    return doc;
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div><div className="topbar-title">Painel do representante</div><div className="topbar-sub">{currentRepresentante.name}</div></div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={refreshAll} title="Atualizar dados" disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'spin' : ''} /></button>
          <button className="icon-btn" onClick={logout} title="Sair"><LogOut size={18} /></button>
        </div>
      </header>
      <div className="form-stack pad">
        <PeriodFilter {...{ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }} />
        <label>Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos (orçamentos e pedidos)</option>
            <option value="orcamento">Só orçamentos</option>
            <option value="pedido">Só pedidos</option>
          </select>
        </label>
        <label>Loja
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">Todas as lojas que atendo</option>
            {myStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Lojas atendidas</div><div className="stat-value">{myStores.length}</div></div>
          <div className="stat-card"><div className="stat-label">Pedidos convertidos</div><div className="stat-value">{pedidosGeral.length}</div></div>
          <div className="stat-card"><div className="stat-label">Minha comissão total</div><div className="stat-value">{currency(totalComissaoGeral)}</div></div>
        </div>

        <h3 className="report-heading">Por loja</h3>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr><th>Loja</th><th>Orçam.</th><th>Pedidos</th><th>Comissão</th><th></th></tr></thead>
            <tbody>
              {porLoja.map(l => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.orcCount} · {currency(l.orcValue)}</td>
                  <td>{l.pedCount} · {currency(l.pedValue)}</td>
                  <td>{currency(l.comissao)}</td>
                  <td><button className="btn-secondary small" onClick={() => setExpandedStoreId(expandedStoreId === l.id ? null : l.id)}><TrendingUp size={13} /> Ranking</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td><strong>Total</strong></td><td>{totalOrcCount} · {currency(totalOrcValue)}</td><td>{totalPedCount} · {currency(totalPedValue)}</td><td>{currency(totalComissaoGeral)}</td><td></td></tr>
            </tfoot>
          </table>
          {porLoja.length === 0 && <p className="hint">Nenhuma loja vinculada a você ainda.</p>}
        </div>

        {expandedStoreId && (
          <div className="ranking-box">
            <div className="report-heading" style={{ marginTop: 0 }}>Ranking de vendedores — {myStores.find(s => s.id === expandedStoreId)?.name}</div>
            {vendorRanking(expandedStoreId, filtered, vendors).map((v, idx) => (
              <div key={v.id} className="ranking-row"><span>{idx + 1}. {v.name}</span><span>{v.count} pedido(s) · {currency(v.total)}</span></div>
            ))}
            {vendorRanking(expandedStoreId, filtered, vendors).length === 0 && <p className="hint">Nenhum vendedor com pedidos nesse período.</p>}
          </div>
        )}

        <h3 className="report-heading">Orçamentos e pedidos {storeFilter ? `— ${myStores.find(s => s.id === storeFilter)?.name}` : '(todas as lojas)'}</h3>
        <div className="admin-list">
          {detailedFiltered.map(o => (
            <div key={o.id} className="order-row">
              <div>
                <div><strong>{o.cliente.nome}</strong> — {o.storeName}</div>
                <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
                <span className={o.status === 'pedido' ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{o.status === 'pedido' ? 'Pedido' : 'Orçamento'}</span>
              </div>
              <div className="order-row-values">
                <span>{currency(o.total)}</span>
                {o.status === 'pedido' && <span className="muted">Loja: {currency(o.commissionStoreValue)}</span>}
                {o.status === 'pedido' && <span className="muted">Minha: {currency(o.commissionRepresentanteValue)}</span>}
              </div>
            </div>
          ))}
          {detailedFiltered.length === 0 && <p className="hint">Nenhum registro para esse filtro.</p>}
        </div>
        {detailedFiltered.length > 0 && (
          <div className="stat-card total-footer">
            <strong>Faturamento total:</strong> {currency(detFaturamento)} · <strong>Comissão da loja:</strong> {currency(detComissaoLoja)} · <strong>Minha comissão:</strong> {currency(detComissaoRep)}
          </div>
        )}
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="relatorio-representante.pdf" />
      </div>
    </div>
  );
}

function AdminScreen({ stores, vendors, representantes, products, orders, updateStores, updateVendors, updateRepresentantes, updateProducts, adminTab, setAdminTab, adminPin, updateAdminPin, setScreen, pdfLibReady, convertToPedido, refreshAll, refreshing }) {
  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-title">Administração</div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={refreshAll} title="Atualizar dados" disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'spin' : ''} /></button>
          <button className="icon-btn" onClick={() => setScreen('login')}><LogOut size={18} /></button>
        </div>
      </header>
      <div className="tabs wrap">
        <button className={adminTab === 'produtos' ? 'tab active' : 'tab'} onClick={() => setAdminTab('produtos')}><Package size={14} /> Produtos</button>
        <button className={adminTab === 'lojas' ? 'tab active' : 'tab'} onClick={() => setAdminTab('lojas')}><Store size={14} /> Lojas</button>
        <button className={adminTab === 'vendedores' ? 'tab active' : 'tab'} onClick={() => setAdminTab('vendedores')}><Users size={14} /> Vendedores</button>
        <button className={adminTab === 'representantes' ? 'tab active' : 'tab'} onClick={() => setAdminTab('representantes')}><UserCog size={14} /> Representantes</button>
        <button className={adminTab === 'pedidos' ? 'tab active' : 'tab'} onClick={() => setAdminTab('pedidos')}><Receipt size={14} /> Orçamentos/Pedidos</button>
        <button className={adminTab === 'relatorios' ? 'tab active' : 'tab'} onClick={() => setAdminTab('relatorios')}><BarChart3 size={14} /> Relatórios</button>
        <button className={adminTab === 'config' ? 'tab active' : 'tab'} onClick={() => setAdminTab('config')}><Settings size={14} /> Config</button>
      </div>
      <div className="admin-body">
        {adminTab === 'produtos' && <ProductsAdmin products={products} updateProducts={updateProducts} />}
        {adminTab === 'lojas' && <StoresAdmin stores={stores} updateStores={updateStores} vendors={vendors} representantes={representantes} />}
        {adminTab === 'vendedores' && <VendorsAdmin vendors={vendors} stores={stores} updateVendors={updateVendors} />}
        {adminTab === 'representantes' && <RepresentantesAdmin representantes={representantes} stores={stores} updateRepresentantes={updateRepresentantes} />}
        {adminTab === 'pedidos' && <OrdersAdmin orders={orders} stores={stores} vendors={vendors} pdfLibReady={pdfLibReady} convertToPedido={convertToPedido} />}
        {adminTab === 'relatorios' && <RelatoriosAdmin orders={orders} stores={stores} vendors={vendors} representantes={representantes} pdfLibReady={pdfLibReady} />}
        {adminTab === 'config' && <ConfigAdmin adminPin={adminPin} updateAdminPin={updateAdminPin} />}
      </div>
    </div>
  );
}

function ProductsAdmin({ products, updateProducts }) {
  const empty = { id: null, name: '', category: '', price: '', photo: '', active: true, peso: '', tamanho: '', qtdEmbalagem: '', qtdCaixa: '', caixaNaoSeAplica: false };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef(null);

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    try {
      const dataUrl = await resizeImage(file);
      setForm(f => ({ ...f, photo: dataUrl }));
    } catch (err) {
      console.error(err);
      setPhotoError('Não foi possível carregar essa imagem. Tente outro arquivo (JPG ou PNG).');
    }
    e.target.value = '';
  };
  const save = () => {
    if (!form.name.trim() || !form.price) return;
    const payload = { ...form, price: Number(form.price), qtdCaixa: form.caixaNaoSeAplica ? '' : form.qtdCaixa };
    if (editingId) updateProducts(current => current.map(p => p.id === editingId ? { ...payload, id: editingId } : p));
    else updateProducts(current => [...current, { ...payload, id: uid() }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (p) => { setForm({ ...empty, ...p, price: String(p.price) }); setEditingId(p.id); };
  const remove = (id) => updateProducts(current => current.filter(p => p.id !== id));

  return (
    <div>
      <div className="admin-form">
        <label>Nome
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Porcelanato Carrara 60x60" />
        </label>
        <label>Categoria
          <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Ex: Porcelanato" list="cats" />
          <datalist id="cats">{CATEGORIES_DEFAULT.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Preço (R$)
          <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0,00" />
        </label>
        <label>Tamanho
          <input value={form.tamanho} onChange={e => setForm({ ...form, tamanho: e.target.value })} placeholder="Ex: 60x60cm" />
        </label>
        <label>Peso (kg)
          <input type="number" step="0.01" value={form.peso} onChange={e => setForm({ ...form, peso: e.target.value })} placeholder="Ex: 22" />
        </label>
        <label>Quantidade por embalagem
          <input type="number" value={form.qtdEmbalagem} onChange={e => setForm({ ...form, qtdEmbalagem: e.target.value })} placeholder="Ex: 4" />
        </label>
        <label>Quantidade por caixa
          <input type="number" value={form.qtdCaixa} disabled={form.caixaNaoSeAplica} onChange={e => setForm({ ...form, qtdCaixa: e.target.value })} placeholder="Ex: 8" />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.caixaNaoSeAplica} onChange={e => setForm({ ...form, caixaNaoSeAplica: e.target.checked, qtdCaixa: e.target.checked ? '' : form.qtdCaixa })} />
          Não se aplica (produto não vem em caixa)
        </label>
        <button type="button" className="file-label" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
          <ImagePlus size={16} /> {form.photo ? 'Trocar foto' : 'Adicionar foto'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
        {photoError && <div className="error">{photoError}</div>}
        {form.photo && <img className="preview-thumb" src={form.photo} alt="" />}
        <div className="admin-form-actions">
          <button className="btn-primary" onClick={save}>{editingId ? 'Salvar alterações' : 'Adicionar produto'}</button>
          {editingId && <button className="btn-secondary" onClick={() => { setForm(empty); setEditingId(null); }}>Cancelar</button>}
        </div>
      </div>
      <div className="admin-list">
        {products.map(p => (
          <div key={p.id} className="admin-list-item">
            <div className="admin-list-photo">{p.photo ? <img src={p.photo} alt="" /> : <Package size={16} />}</div>
            <div className="admin-list-info">
              <div>{p.name}</div>
              <div className="muted">{p.category} · {currency(p.price)}</div>
              {productSpecsLine(p) && <div className="muted">{productSpecsLine(p)}</div>}
            </div>
            <button className="icon-btn" onClick={() => edit(p)}>✎</button>
            <button className="icon-btn" onClick={() => remove(p.id)}><Trash2 size={16} /></button>
          </div>
        ))}
        {products.length === 0 && <p className="hint">Nenhum produto cadastrado ainda.</p>}
      </div>
    </div>
  );
}

function StoresAdmin({ stores, updateStores, vendors, representantes }) {
  const empty = { id: null, name: '', endereco: '', commissionPercent: '', representanteId: '', representanteCommissionPercent: '', modalidade: 'representacao', descontoRevenda: '' };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (!form.name.trim()) return;
    const payload = { ...form, commissionPercent: Number(form.commissionPercent) || 0, representanteCommissionPercent: Number(form.representanteCommissionPercent) || 0, descontoRevenda: Number(form.descontoRevenda) || 0 };
    if (editingId) updateStores(current => current.map(s => s.id === editingId ? { ...payload, id: editingId } : s));
    else updateStores(current => [...current, { ...payload, id: uid() }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (s) => { setForm({ ...empty, ...s, commissionPercent: String(s.commissionPercent), representanteCommissionPercent: String(s.representanteCommissionPercent || ''), descontoRevenda: String(s.descontoRevenda || ''), modalidade: s.modalidade || 'representacao' }); setEditingId(s.id); };
  const remove = (id) => updateStores(current => current.filter(s => s.id !== id));
  return (
    <div>
      <div className="admin-form">
        <label>Nome da loja
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Loja Centro" />
        </label>
        <label>Endereço completo
          <input value={form.endereco} onChange={e => setForm({ ...form, endereco: e.target.value })} placeholder="Rua, número, bairro, cidade, estado, CEP" />
        </label>
        <label>Modalidade
          <select value={form.modalidade} onChange={e => setForm({ ...form, modalidade: e.target.value })}>
            <option value="representacao">Representação</option>
            <option value="revenda">Revenda</option>
          </select>
        </label>
        {form.modalidade === 'revenda' && (
          <label>Desconto de revenda da loja (%) — aplicado automaticamente em todo orçamento
            <input type="number" step="0.1" value={form.descontoRevenda} onChange={e => setForm({ ...form, descontoRevenda: e.target.value })} placeholder="Ex: 10" />
          </label>
        )}
        <label>Comissão da loja (%)
          <input type="number" step="0.1" value={form.commissionPercent} onChange={e => setForm({ ...form, commissionPercent: e.target.value })} placeholder="Ex: 3" />
        </label>
        <label>Representante que atende esta loja
          <select value={form.representanteId} onChange={e => setForm({ ...form, representanteId: e.target.value })}>
            <option value="">Nenhum (atendida por vendedor próprio)</option>
            {representantes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {form.representanteId && (
          <label>Comissão do representante sobre esta loja (%)
            <input type="number" step="0.1" value={form.representanteCommissionPercent} onChange={e => setForm({ ...form, representanteCommissionPercent: e.target.value })} placeholder="Ex: 4" />
          </label>
        )}
        <div className="admin-form-actions">
          <button className="btn-primary" onClick={save}>{editingId ? 'Salvar alterações' : 'Adicionar loja'}</button>
          {editingId && <button className="btn-secondary" onClick={() => { setForm(empty); setEditingId(null); }}>Cancelar</button>}
        </div>
        {representantes.length === 0 && <p className="hint">Nenhum representante cadastrado ainda — cadastre primeiro na aba "Representantes" para poder vinculá-lo aqui.</p>}
      </div>
      <div className="admin-list">
        {stores.map(s => {
          const vCount = vendors.filter(v => v.storeId === s.id).length;
          const rep = representantes.find(r => r.id === s.representanteId);
          return (
            <div key={s.id} className="admin-list-item">
              <div className="admin-list-info">
                <div>{s.name} <span className="status-badge status-orcamento" style={{ marginLeft: 6 }}>{s.modalidade === 'revenda' ? 'Revenda' : 'Representação'}</span></div>
                <div className="muted">Comissão: {s.commissionPercent}% · {vCount} vendedor(es){rep ? ` · Representante: ${rep.name} (${s.representanteCommissionPercent || 0}%)` : ''}{s.modalidade === 'revenda' ? ` · Desconto revenda: ${s.descontoRevenda || 0}%` : ''}</div>
                {s.endereco && <div className="muted">{s.endereco}</div>}
              </div>
              <button className="icon-btn" onClick={() => edit(s)}>✎</button>
              <button className="icon-btn" onClick={() => remove(s.id)}><Trash2 size={16} /></button>
            </div>
          );
        })}
        {stores.length === 0 && <p className="hint">Nenhuma loja cadastrada ainda.</p>}
      </div>
    </div>
  );
}

function VendorsAdmin({ vendors, stores, updateVendors }) {
  const empty = { id: null, name: '', storeId: '', commissionPercent: '', pin: '' };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (!form.name.trim() || !form.storeId || !form.pin) return;
    if (editingId) updateVendors(current => current.map(v => v.id === editingId ? { ...form, id: editingId, commissionPercent: Number(form.commissionPercent) || 0 } : v));
    else updateVendors(current => [...current, { ...form, id: uid(), commissionPercent: Number(form.commissionPercent) || 0 }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (v) => { setForm({ ...v, commissionPercent: String(v.commissionPercent) }); setEditingId(v.id); };
  const remove = (id) => updateVendors(current => current.filter(v => v.id !== id));
  return (
    <div>
      <div className="admin-form">
        <label>Nome do vendedor
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Maria Souza" />
        </label>
        <label>Loja
          <select value={form.storeId} onChange={e => setForm({ ...form, storeId: e.target.value })}>
            <option value="">Selecione a loja</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Comissão do vendedor (%)
          <input type="number" step="0.1" value={form.commissionPercent} onChange={e => setForm({ ...form, commissionPercent: e.target.value })} placeholder="Ex: 5" />
        </label>
        <label>PIN de acesso
          <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} placeholder="Ex: 1234" maxLength={6} />
        </label>
        <div className="admin-form-actions">
          <button className="btn-primary" onClick={save}>{editingId ? 'Salvar alterações' : 'Adicionar vendedor'}</button>
          {editingId && <button className="btn-secondary" onClick={() => { setForm(empty); setEditingId(null); }}>Cancelar</button>}
        </div>
      </div>
      <div className="admin-list">
        {vendors.map(v => (
          <div key={v.id} className="admin-list-item">
            <div className="admin-list-info"><div>{v.name}</div><div className="muted">{stores.find(s => s.id === v.storeId)?.name || '—'} · Comissão {v.commissionPercent}% · PIN {v.pin}</div></div>
            <button className="icon-btn" onClick={() => edit(v)}>✎</button>
            <button className="icon-btn" onClick={() => remove(v.id)}><Trash2 size={16} /></button>
          </div>
        ))}
        {vendors.length === 0 && <p className="hint">Nenhum vendedor cadastrado ainda.</p>}
      </div>
    </div>
  );
}

function RepresentantesAdmin({ representantes, stores, updateRepresentantes }) {
  const empty = { id: null, name: '', documento: '', telefone: '', endereco: '', banco: '', agencia: '', conta: '', tipoConta: '', pix: '', pin: '' };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);

  const save = () => {
    if (!form.name.trim()) return;
    if (editingId) updateRepresentantes(current => current.map(r => r.id === editingId ? { ...form, id: editingId } : r));
    else updateRepresentantes(current => [...current, { ...form, id: uid() }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (r) => { setForm({ ...empty, ...r }); setEditingId(r.id); };
  const remove = (id) => updateRepresentantes(current => current.filter(r => r.id !== id));
  return (
    <div>
      <div className="admin-form">
        <p className="hint">Cadastre aqui os dados do representante. Depois, vá na aba "Lojas" e selecione qual representante atende cada loja (e a comissão dele sobre aquela loja).</p>
        <label>Nome do representante
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Carlos Mendes" />
        </label>
        <label>CPF ou CNPJ
          <input value={form.documento} onChange={e => setForm({ ...form, documento: e.target.value })} placeholder="000.000.000-00 ou 00.000.000/0000-00" />
        </label>
        <label>Telefone
          <input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} placeholder="(00) 00000-0000" />
        </label>
        <label>Endereço
          <input value={form.endereco} onChange={e => setForm({ ...form, endereco: e.target.value })} placeholder="Rua, número, cidade, estado" />
        </label>
        <label>PIN de acesso ao painel do representante
          <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} placeholder="Ex: 1234" maxLength={6} />
        </label>
        <div className="form-subsection">Dados bancários</div>
        <label>Banco
          <input value={form.banco} onChange={e => setForm({ ...form, banco: e.target.value })} placeholder="Ex: Banco do Brasil" />
        </label>
        <div className="admin-form-actions" style={{ gap: 12 }}>
          <label style={{ flex: 1 }}>Agência
            <input value={form.agencia} onChange={e => setForm({ ...form, agencia: e.target.value })} placeholder="Ex: 1234" />
          </label>
          <label style={{ flex: 1 }}>Conta
            <input value={form.conta} onChange={e => setForm({ ...form, conta: e.target.value })} placeholder="Ex: 12345-6" />
          </label>
        </div>
        <label>Tipo de conta
          <select value={form.tipoConta} onChange={e => setForm({ ...form, tipoConta: e.target.value })}>
            <option value="">Selecione</option>
            <option value="Corrente">Corrente</option>
            <option value="Poupança">Poupança</option>
          </select>
        </label>
        <label>Chave PIX
          <input value={form.pix} onChange={e => setForm({ ...form, pix: e.target.value })} placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória" />
        </label>
        <div className="admin-form-actions">
          <button className="btn-primary" onClick={save}>{editingId ? 'Salvar alterações' : 'Adicionar representante'}</button>
          {editingId && <button className="btn-secondary" onClick={() => { setForm(empty); setEditingId(null); }}>Cancelar</button>}
        </div>
      </div>
      <div className="admin-list">
        {representantes.map(r => {
          const lojasAtendidas = stores.filter(s => s.representanteId === r.id);
          return (
            <div key={r.id} className="admin-list-item">
              <div className="admin-list-info">
                <div>{r.name}</div>
                <div className="muted">{lojasAtendidas.length > 0 ? lojasAtendidas.map(s => s.name).join(', ') : 'Ainda não vinculado a nenhuma loja'}</div>
                <div className="muted">{r.documento || '—'} · {r.telefone || '—'} · PIN {r.pin || '—'}</div>
                {(r.banco || r.pix) && <div className="muted">{r.banco ? `${r.banco} · Ag ${r.agencia || '—'} · Conta ${r.conta || '—'} (${r.tipoConta || '—'})` : ''} {r.pix ? `· PIX: ${r.pix}` : ''}</div>}
              </div>
              <button className="icon-btn" onClick={() => edit(r)}>✎</button>
              <button className="icon-btn" onClick={() => remove(r.id)}><Trash2 size={16} /></button>
            </div>
          );
        })}
        {representantes.length === 0 && <p className="hint">Nenhum representante cadastrado ainda.</p>}
      </div>
    </div>
  );
}

function OrdersAdmin({ orders, stores, vendors, pdfLibReady, convertToPedido }) {
  const [filterStore, setFilterStore] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const vendorOptions = filterStore ? vendors.filter(v => v.storeId === filterStore) : vendors;

  const filtered = orders.filter(o => {
    if (filterStore && o.storeId !== filterStore) return false;
    if (filterVendor && o.vendorId !== filterVendor) return false;
    if (filterStatus && o.status !== filterStatus) return false;
    const d = o.createdAt.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const pedidos = filtered.filter(o => o.status === 'pedido');
  const orcamentosPendentes = filtered.filter(o => o.status === 'orcamento');
  const totalVendas = pedidos.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalComissaoLoja = pedidos.reduce((s, o) => s + (Number(o.commissionStoreValue) || 0), 0);
  const totalComissaoVendedor = pedidos.reduce((s, o) => s + (Number(o.commissionVendorValue) || 0), 0);
  const totalOrcamentos = orcamentosPendentes.reduce((s, o) => s + (Number(o.total) || 0), 0);

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(15);
    doc.text('Relatório de pedidos e comissões', 14, y); y += 8;
    doc.setFontSize(9);
    const storeName = filterStore ? (stores.find(s => s.id === filterStore)?.name || '') : 'Todas as lojas';
    const vendorName = filterVendor ? (vendors.find(v => v.id === filterVendor)?.name || '') : 'Todos os vendedores';
    doc.text(`Loja: ${storeName}`, 14, y); y += 5;
    doc.text(`Vendedor: ${vendorName}`, 14, y); y += 5;
    doc.text(`Período: ${dateFrom || 'início'} até ${dateTo || 'hoje'}`, 14, y); y += 8;
    doc.setFontSize(10);
    doc.text('Data', 14, y); doc.text('Cliente', 36, y); doc.text('Vendedor', 82, y); doc.text('Status', 118, y); doc.text('Total', 140, y); doc.text('C.loja', 160, y); doc.text('C.vend.', 178, y);
    y += 2; doc.line(14, y, 196, y); y += 6;
    filtered.forEach(o => {
      doc.text(new Date(o.createdAt).toLocaleDateString('pt-BR'), 14, y);
      doc.text(String(o.cliente.nome).slice(0, 18), 36, y);
      doc.text(String(o.vendorName).slice(0, 14), 82, y);
      doc.text(o.status === 'pedido' ? 'Pedido' : 'Orçam.', 118, y);
      doc.text(currency(o.total), 140, y);
      doc.text(currency(o.commissionStoreValue), 160, y);
      doc.text(currency(o.commissionVendorValue), 178, y);
      y += 7;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 4; doc.line(14, y, 196, y); y += 8;
    doc.setFontSize(11);
    doc.text(`Total vendido (pedidos): ${currency(totalVendas)}`, 14, y); y += 6;
    doc.text(`Comissão lojas: ${currency(totalComissaoLoja)}`, 14, y); y += 6;
    doc.text(`Comissão vendedores: ${currency(totalComissaoVendedor)}`, 14, y); y += 6;
    doc.text(`Em orçamento (não convertido): ${currency(totalOrcamentos)}`, 14, y);
    return doc;
  };

  return (
    <div>
      <div className="admin-form">
        <label>Loja
          <select value={filterStore} onChange={e => { setFilterStore(e.target.value); setFilterVendor(''); }}>
            <option value="">Todas as lojas</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Vendedor
          <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}>
            <option value="">Todos os vendedores</option>
            {vendorOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label>Status
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Todos (orçamentos e pedidos)</option>
            <option value="orcamento">Só orçamentos</option>
            <option value="pedido">Só pedidos</option>
          </select>
        </label>
        <div className="admin-form-actions" style={{ gap: 12 }}>
          <label style={{ flex: 1 }}>De
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>Até
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
        </div>
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="relatorio-comissoes.pdf" />
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total vendido (pedidos)</div><div className="stat-value">{currency(totalVendas)}</div></div>
        <div className="stat-card"><div className="stat-label">Comissão lojas</div><div className="stat-value">{currency(totalComissaoLoja)}</div></div>
        <div className="stat-card"><div className="stat-label">Comissão vendedores</div><div className="stat-value">{currency(totalComissaoVendedor)}</div></div>
        <div className="stat-card"><div className="stat-label">Em orçamento</div><div className="stat-value">{currency(totalOrcamentos)}</div></div>
      </div>
      <div className="admin-list">
        {filtered.map(o => (
          <div key={o.id} className="order-row">
            <div>
              <div><strong>{o.cliente.nome}</strong> — {o.vendorName} ({o.storeName})</div>
              <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
              <span className={o.status === 'pedido' ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{o.status === 'pedido' ? 'Pedido' : 'Orçamento'}</span>
            </div>
            <div className="order-row-values">
              <span>{currency(o.total)}</span>
              <span className="muted">Loja: {currency(o.commissionStoreValue)}</span>
              <span className="muted">Vend.: {currency(o.commissionVendorValue)}</span>
              {o.status === 'orcamento' && (
                <button className="btn-secondary small" onClick={() => convertToPedido(o.id)}><CheckCircle2 size={14} /> Converter</button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="hint">Nenhum registro encontrado para esse filtro.</p>}
      </div>
    </div>
  );
}

function RelatoriosAdmin({ orders, stores, vendors, representantes, pdfLibReady }) {
  const [filterStore, setFilterStore] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterRepresentante, setFilterRepresentante] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedStoreId, setExpandedStoreId] = useState(null);

  const vendorOptions = filterStore ? vendors.filter(v => v.storeId === filterStore) : vendors;

  const filteredOrders = orders.filter(o => {
    if (filterStore && o.storeId !== filterStore) return false;
    if (filterVendor && o.vendorId !== filterVendor) return false;
    const d = o.createdAt.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const vendorsToShow = filterVendor ? vendors.filter(v => v.id === filterVendor) : vendorOptions;
  const storesToShow = filterStore ? stores.filter(s => s.id === filterStore) : stores;

  const porVendedor = vendorsToShow.map(v => {
    const os = filteredOrders.filter(o => o.vendorId === v.id);
    const pedidos = os.filter(o => o.status === 'pedido');
    const orcamentosValue = os.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const pedidosValue = pedidos.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const comissao = pedidos.reduce((s, o) => s + (Number(o.commissionVendorValue) || 0), 0);
    const taxaConversao = os.length ? (pedidos.length / os.length) * 100 : 0;
    const storeName = stores.find(s => s.id === v.storeId)?.name || '—';
    return { id: v.id, name: v.name, storeName, orcCount: os.length, orcValue: orcamentosValue, pedCount: pedidos.length, pedValue: pedidosValue, taxaConversao, comissao };
  });
  const totVendOrc = porVendedor.reduce((s, v) => s + v.orcCount, 0);
  const totVendOrcValue = porVendedor.reduce((s, v) => s + v.orcValue, 0);
  const totVendPed = porVendedor.reduce((s, v) => s + v.pedCount, 0);
  const totVendPedValue = porVendedor.reduce((s, v) => s + v.pedValue, 0);
  const totVendComissao = porVendedor.reduce((s, v) => s + v.comissao, 0);

  const porLoja = storesToShow.map(s => {
    const os = filteredOrders.filter(o => o.storeId === s.id);
    const pedidos = os.filter(o => o.status === 'pedido');
    const orcamentosValue = os.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const pedidosValue = pedidos.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const comissaoLoja = pedidos.reduce((sum, o) => sum + (Number(o.commissionStoreValue) || 0), 0);
    const rep = representantes.find(r => r.id === s.representanteId);
    const comissaoRepresentante = pedidos.reduce((sum, o) => sum + (Number(o.commissionRepresentanteValue) || 0), 0);
    return { id: s.id, name: s.name, orcCount: os.length, orcValue: orcamentosValue, pedCount: pedidos.length, pedValue: pedidosValue, comissaoLoja, repName: rep?.name || null, comissaoRepresentante };
  });
  const totLojaOrc = porLoja.reduce((s, l) => s + l.orcCount, 0);
  const totLojaOrcValue = porLoja.reduce((s, l) => s + l.orcValue, 0);
  const totLojaPed = porLoja.reduce((s, l) => s + l.pedCount, 0);
  const totLojaPedValue = porLoja.reduce((s, l) => s + l.pedValue, 0);
  const totLojaComissao = porLoja.reduce((s, l) => s + l.comissaoLoja, 0);
  const totLojaComissaoRep = porLoja.reduce((s, l) => s + l.comissaoRepresentante, 0);

  const representantesToShow = filterRepresentante ? representantes.filter(r => r.id === filterRepresentante) : (filterStore ? representantes.filter(r => r.id === stores.find(s => s.id === filterStore)?.representanteId) : representantes);
  const porRepresentante = representantesToShow.map(r => {
    const lojasDoRep = stores.filter(s => s.representanteId === r.id);
    const lojaIds = lojasDoRep.map(s => s.id);
    const os = filteredOrders.filter(o => lojaIds.includes(o.storeId));
    const pedidos = os.filter(o => o.status === 'pedido');
    const pedidosValue = pedidos.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const comissao = pedidos.reduce((sum, o) => sum + (Number(o.commissionRepresentanteValue) || 0), 0);
    const storeNames = lojasDoRep.map(s => s.name).join(', ') || '—';
    return { id: r.id, name: r.name, storeName: storeNames, pedCount: pedidos.length, pedValue: pedidosValue, comissao };
  });
  const totRepPed = porRepresentante.reduce((s, r) => s + r.pedCount, 0);
  const totRepPedValue = porRepresentante.reduce((s, r) => s + r.pedValue, 0);
  const totRepComissao = porRepresentante.reduce((s, r) => s + r.comissao, 0);

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(15);
    doc.text('Relatório de desempenho', 14, y); y += 8;
    doc.setFontSize(9);
    const storeName = filterStore ? (stores.find(s => s.id === filterStore)?.name || '') : 'Todas as lojas';
    const vendorName = filterVendor ? (vendors.find(v => v.id === filterVendor)?.name || '') : 'Todos os vendedores';
    doc.text(`Loja: ${storeName} · Vendedor: ${vendorName}`, 14, y); y += 5;
    doc.text(`Período: ${dateFrom || 'início'} até ${dateTo || 'hoje'}`, 14, y); y += 10;

    doc.setFontSize(12);
    doc.text('Por vendedor', 14, y); y += 7;
    doc.setFontSize(9);
    doc.text('Vendedor', 14, y); doc.text('Loja', 60, y); doc.text('Orçam.', 100, y); doc.text('Pedidos', 125, y); doc.text('Conv.', 155, y); doc.text('Comissão', 172, y);
    y += 2; doc.line(14, y, 196, y); y += 6;
    porVendedor.forEach(v => {
      doc.text(String(v.name).slice(0, 22), 14, y);
      doc.text(String(v.storeName).slice(0, 16), 60, y);
      doc.text(String(v.orcCount), 100, y);
      doc.text(String(v.pedCount), 125, y);
      doc.text(`${v.taxaConversao.toFixed(0)}%`, 155, y);
      doc.text(currency(v.comissao), 172, y);
      y += 6;
      if (y > 265) { doc.addPage(); y = 20; }
    });
    y += 2; doc.line(14, y, 196, y); y += 6;
    doc.setFontSize(9);
    doc.text(`Total: ${totVendOrc} orçam. (${currency(totVendOrcValue)}) · ${totVendPed} pedidos (${currency(totVendPedValue)}) · Comissão ${currency(totVendComissao)}`, 14, y);

    y += 12;
    doc.setFontSize(12);
    doc.text('Por loja', 14, y); y += 7;
    doc.setFontSize(9);
    doc.text('Loja', 14, y); doc.text('Orçam.', 70, y); doc.text('Pedidos', 95, y); doc.text('C. loja', 125, y); doc.text('Representante', 150, y); doc.text('C. repr.', 178, y);
    y += 2; doc.line(14, y, 196, y); y += 6;
    porLoja.forEach(s => {
      doc.text(String(s.name).slice(0, 26), 14, y);
      doc.text(String(s.orcCount), 70, y);
      doc.text(String(s.pedCount), 95, y);
      doc.text(currency(s.comissaoLoja), 125, y);
      doc.text(String(s.repName || '—').slice(0, 14), 150, y);
      doc.text(currency(s.comissaoRepresentante), 178, y);
      y += 6;
      if (y > 265) { doc.addPage(); y = 20; }
    });
    y += 2; doc.line(14, y, 196, y); y += 6;
    doc.setFontSize(9);
    doc.text(`Total: ${totLojaOrc} orçam. (${currency(totLojaOrcValue)}) · ${totLojaPed} pedidos (${currency(totLojaPedValue)}) · C.loja ${currency(totLojaComissao)} · C.repr. ${currency(totLojaComissaoRep)}`, 14, y);

    y += 12;
    doc.setFontSize(12);
    doc.text('Por representante', 14, y); y += 7;
    doc.setFontSize(9);
    doc.text('Representante', 14, y); doc.text('Loja', 70, y); doc.text('Pedidos', 120, y); doc.text('Comissão', 155, y);
    y += 2; doc.line(14, y, 196, y); y += 6;
    porRepresentante.forEach(r => {
      doc.text(String(r.name).slice(0, 26), 14, y);
      doc.text(String(r.storeName).slice(0, 20), 70, y);
      doc.text(String(r.pedCount), 120, y);
      doc.text(currency(r.comissao), 155, y);
      y += 6;
      if (y > 265) { doc.addPage(); y = 20; }
    });
    y += 2; doc.line(14, y, 196, y); y += 6;
    doc.setFontSize(9);
    doc.text(`Total: ${totRepPed} pedidos (${currency(totRepPedValue)}) · Comissão ${currency(totRepComissao)}`, 14, y);

    return doc;
  };

  return (
    <div>
      <div className="admin-form">
        <label>Loja
          <select value={filterStore} onChange={e => { setFilterStore(e.target.value); setFilterVendor(''); }}>
            <option value="">Todas as lojas</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Vendedor
          <select value={filterVendor} onChange={e => setFilterVendor(e.target.value)}>
            <option value="">Todos os vendedores</option>
            {vendorOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label>Representante
          <select value={filterRepresentante} onChange={e => setFilterRepresentante(e.target.value)}>
            <option value="">Todos os representantes</option>
            {(filterStore ? representantes.filter(r => r.id === stores.find(s => s.id === filterStore)?.representanteId) : representantes).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <div className="admin-form-actions" style={{ gap: 12 }}>
          <label style={{ flex: 1 }}>De
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label style={{ flex: 1 }}>Até
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
        </div>
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="relatorio-desempenho.pdf" />
      </div>

      <h3 className="report-heading">Por vendedor</h3>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr><th>Vendedor</th><th>Loja</th><th>Orçam.</th><th>Pedidos</th><th>Tx. conversão</th><th>Comissão</th></tr></thead>
          <tbody>
            {porVendedor.map(v => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.storeName}</td>
                <td>{v.orcCount} · {currency(v.orcValue)}</td>
                <td>{v.pedCount} · {currency(v.pedValue)}</td>
                <td>{v.taxaConversao.toFixed(0)}%</td>
                <td>{currency(v.comissao)}</td>
              </tr>
            ))}
          </tbody>
          {porVendedor.length > 0 && (
            <tfoot><tr><td colSpan={2}><strong>Total</strong></td><td>{totVendOrc} · {currency(totVendOrcValue)}</td><td>{totVendPed} · {currency(totVendPedValue)}</td><td></td><td>{currency(totVendComissao)}</td></tr></tfoot>
          )}
        </table>
        {porVendedor.length === 0 && <p className="hint">Nenhum vendedor encontrado para esse filtro.</p>}
      </div>

      <h3 className="report-heading">Por loja</h3>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr><th>Loja</th><th>Orçam.</th><th>Pedidos</th><th>Comissão loja</th><th>Representante</th><th>Comissão repr.</th><th></th></tr></thead>
          <tbody>
            {porLoja.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.orcCount} · {currency(s.orcValue)}</td>
                <td>{s.pedCount} · {currency(s.pedValue)}</td>
                <td>{currency(s.comissaoLoja)}</td>
                <td>{s.repName || '—'}</td>
                <td>{currency(s.comissaoRepresentante)}</td>
                <td><button className="btn-secondary small" onClick={() => setExpandedStoreId(expandedStoreId === s.id ? null : s.id)}><TrendingUp size={13} /> Ranking</button></td>
              </tr>
            ))}
          </tbody>
          {porLoja.length > 0 && (
            <tfoot><tr><td><strong>Total</strong></td><td>{totLojaOrc} · {currency(totLojaOrcValue)}</td><td>{totLojaPed} · {currency(totLojaPedValue)}</td><td>{currency(totLojaComissao)}</td><td></td><td>{currency(totLojaComissaoRep)}</td><td></td></tr></tfoot>
          )}
        </table>
        {porLoja.length === 0 && <p className="hint">Nenhuma loja encontrada para esse filtro.</p>}
      </div>

      {expandedStoreId && (
        <div className="ranking-box">
          <div className="report-heading" style={{ marginTop: 0 }}>Ranking de vendedores — {stores.find(s => s.id === expandedStoreId)?.name}</div>
          {vendorRanking(expandedStoreId, filteredOrders, vendors).map((v, idx) => (
            <div key={v.id} className="ranking-row"><span>{idx + 1}. {v.name}</span><span>{v.count} pedido(s) · {currency(v.total)}</span></div>
          ))}
          {vendorRanking(expandedStoreId, filteredOrders, vendors).length === 0 && <p className="hint">Nenhum vendedor com pedidos nesse período.</p>}
        </div>
      )}

      <h3 className="report-heading">Por representante</h3>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead><tr><th>Representante</th><th>Loja</th><th>Pedidos</th><th>Comissão</th></tr></thead>
          <tbody>
            {porRepresentante.map(r => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.storeName}</td>
                <td>{r.pedCount} · {currency(r.pedValue)}</td>
                <td>{currency(r.comissao)}</td>
              </tr>
            ))}
          </tbody>
          {porRepresentante.length > 0 && (
            <tfoot><tr><td colSpan={2}><strong>Total</strong></td><td>{totRepPed} · {currency(totRepPedValue)}</td><td>{currency(totRepComissao)}</td></tr></tfoot>
          )}
        </table>
        {porRepresentante.length === 0 && <p className="hint">Nenhum representante encontrado para esse filtro.</p>}
      </div>
    </div>
  );
}

function ConfigAdmin({ adminPin, updateAdminPin }) {
  const [pin, setPin] = useState(adminPin);
  return (
    <div className="admin-form">
      <label>PIN de administrador
        <input value={pin} onChange={e => setPin(e.target.value)} maxLength={8} />
      </label>
      <button className="btn-primary" onClick={() => updateAdminPin(pin)}>Salvar PIN</button>
      <p className="hint">Este PIN dá acesso à área de administração (produtos, lojas, vendedores, representantes e comissões). A segurança aqui é simples, sem criptografia — guarde-o com os administradores de confiança.</p>
    </div>
  );
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap');

:root {
  --bg: #EDEBE5;
  --surface: #FFFFFF;
  --ink: #1B1A18;
  --ink-soft: #6F6D65;
  --line: #D9D6CD;
  --clay: #2A2A27;
  --clay-dark: #000000;
  --teal: #57554C;
  --teal-dark: #3B3A34;
}
* { box-sizing: border-box; }
.app-root { font-family: 'Inter', sans-serif; color: var(--ink); background: var(--bg); min-height: 100vh; }
h1, h2 { font-family: 'Fraunces', serif; margin: 0; letter-spacing: -0.01em; }
.screen-center { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.login-card { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 36px 32px; width: 100%; max-width: 380px; }
.login-header { text-align: left; margin-bottom: 24px; }
.tile-mark { display: grid; grid-template-columns: repeat(2, 14px); grid-template-rows: repeat(2, 14px); gap: 3px; margin-bottom: 16px; }
.tile-mark span { background: var(--clay); }
.tile-mark span:nth-child(2), .tile-mark span:nth-child(3) { background: var(--ink-soft); }
.login-header h1 { font-size: 24px; font-weight: 600; line-height: 1.2; }
.login-header p { margin: 6px 0 0; color: var(--ink-soft); font-size: 14px; }
.tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--line); }
.tabs.wrap { flex-wrap: wrap; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.tab { flex: none; background: none; border: none; padding: 10px 14px; font-size: 13px; font-weight: 500; color: var(--ink-soft); cursor: pointer; border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 6px; }
.tab.active { color: var(--ink); border-bottom-color: var(--clay); }
.form-stack { display: flex; flex-direction: column; gap: 14px; }
.form-stack.pad { padding: 16px; }
.form-stack label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink-soft); }
input, select, textarea { font-family: inherit; font-size: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); color: var(--ink); }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--clay); outline-offset: 1px; }
.btn-primary { background: var(--clay); color: #fff; border: none; padding: 12px 16px; border-radius: 3px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-primary:hover { background: var(--clay-dark); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--surface); color: var(--ink); border: 1px solid var(--line); padding: 12px 16px; border-radius: 3px; font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-secondary.small { padding: 6px 10px; font-size: 12px; }
.btn-whatsapp { background: var(--teal); color: #fff; border: none; padding: 12px 16px; border-radius: 3px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; }
.btn-whatsapp:hover { background: var(--teal-dark); }
.error { color: var(--clay-dark); font-size: 13px; }
.hint { color: var(--ink-soft); font-size: 12px; line-height: 1.5; }
.screen { max-width: 720px; margin: 0 auto; min-height: 100vh; background: var(--bg); padding-bottom: 32px; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px; background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
.topbar-left { display: flex; gap: 8px; }
.topbar-title { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.topbar-sub { font-size: 12px; color: var(--ink-soft); }
.topbar-actions { display: flex; gap: 8px; align-items: center; }
.icon-btn { background: none; border: 1px solid var(--line); width: 34px; height: 34px; border-radius: 3px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--ink); }
.icon-btn:disabled { opacity: 0.5; cursor: default; }
.spin { animation: spin-anim 1s linear infinite; }
@keyframes spin-anim { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.cart-btn { position: relative; background: var(--ink); color: #fff; border: none; width: 34px; height: 34px; border-radius: 3px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.badge { position: absolute; top: -6px; right: -6px; background: var(--teal); color: #fff; font-size: 10px; font-weight: 700; min-width: 16px; height: 16px; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 0 3px; }
.search-row { display: flex; align-items: center; gap: 8px; margin: 16px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 3px; color: var(--ink-soft); }
.search-row input { border: none; flex: 1; padding: 0; }
.search-row input:focus { outline: none; }
.chip-row { display: flex; gap: 8px; padding: 0 16px 8px; overflow-x: auto; }
.chip { flex: none; background: var(--surface); border: 1px solid var(--line); padding: 6px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; color: var(--ink-soft); white-space: nowrap; }
.chip.active { background: var(--ink); color: #fff; border-color: var(--ink); }
.product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; padding: 0 16px 90px; }
.product-card { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; position: relative; display: flex; flex-direction: column; }
.product-photo { aspect-ratio: 1; background: var(--bg); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.product-photo img { width: 100%; height: 100%; object-fit: cover; }
.photo-placeholder { color: var(--ink-soft); }
.product-info { padding: 10px 12px; }
.product-name { font-size: 13px; font-weight: 600; line-height: 1.3; }
.product-category { font-size: 11px; color: var(--ink-soft); margin: 2px 0 2px; }
.product-specs { font-size: 10px; color: var(--ink-soft); margin: 0 0 6px; }
.product-price { font-size: 14px; font-weight: 600; color: var(--clay-dark); }
.add-btn { position: absolute; bottom: 46px; right: 8px; background: var(--ink); color: #fff; border: none; width: 30px; height: 30px; border-radius: 15px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; color: var(--ink-soft); gap: 10px; text-align: center; }
.floating-cart { position: fixed; bottom: 16px; left: 16px; right: 16px; max-width: 688px; margin: 0 auto; background: var(--ink); color: #fff; padding: 14px 18px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; cursor: pointer; }
.cart-list { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.cart-item { display: flex; align-items: flex-start; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 10px; }
.cart-item-photo { width: 44px; height: 44px; border-radius: 3px; overflow: hidden; background: var(--bg); display: flex; align-items: center; justify-content: center; flex: none; color: var(--ink-soft); }
.cart-item-photo img { width: 100%; height: 100%; object-fit: cover; }
.cart-item-info { flex: 1; }
.cart-item-name { font-size: 13px; font-weight: 600; }
.cart-item-price { font-size: 12px; color: var(--ink-soft); }
.disc-tag { color: var(--clay-dark); font-weight: 600; margin-left: 4px; }
.disc-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px; color: var(--ink-soft); }
.disc-input { width: 52px; padding: 4px 6px; font-size: 12px; }
.qty-control { display: flex; align-items: center; gap: 6px; }
.qty-control button { width: 26px; height: 26px; border: 1px solid var(--line); background: var(--surface); border-radius: 3px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.qty-control span { min-width: 18px; text-align: center; font-size: 13px; font-weight: 600; cursor: pointer; }
.cart-summary { padding: 16px; border-top: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; gap: 12px; }
.cart-total-row { display: flex; justify-content: space-between; align-items: center; font-size: 15px; padding: 8px 0; }
.cart-total-row.muted-row { font-size: 13px; color: var(--ink-soft); padding: 0; }
.printable { background: var(--surface); margin: 16px; padding: 24px; border: 1px solid var(--line); border-radius: 4px; }
.printable .muted { color: var(--ink-soft); font-size: 13px; margin: 4px 0 0; }
.divider { height: 1px; background: var(--line); margin: 16px 0; }
.order-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.order-table th { text-align: left; color: var(--ink-soft); font-weight: 500; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.order-table td { padding: 8px 0; border-bottom: 1px solid var(--line); }
.order-table tr.spec-row td { padding: 0 0 8px; border-bottom: 1px solid var(--line); font-size: 11px; color: var(--ink-soft); }
.order-total { text-align: right; font-size: 16px; font-weight: 700; margin: 16px 0; color: var(--clay-dark); }
.status-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 20px; margin-top: 4px; }
.status-badge.status-orcamento { background: var(--bg); color: var(--ink-soft); border: 1px solid var(--line); }
.status-badge.status-pedido { background: var(--ink); color: #fff; }
.admin-body { padding: 16px; }
.admin-list.pad { padding: 0; }
.admin-form { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
.admin-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink-soft); }
.admin-form-actions { display: flex; gap: 10px; }
.checkbox-row { display: flex !important; flex-direction: row !important; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
.checkbox-row input { width: auto; }
.form-subsection { font-size: 12px; font-weight: 600; color: var(--ink); border-top: 1px solid var(--line); padding-top: 10px; margin-top: 4px; }
.file-label { display: flex; align-items: center; gap: 8px; border: 1px dashed var(--line); background: var(--surface); color: var(--ink); padding: 10px 12px; border-radius: 3px; cursor: pointer; font-size: 13px; font-family: inherit; width: fit-content; }
.preview-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 3px; border: 1px solid var(--line); }
.admin-list { display: flex; flex-direction: column; gap: 8px; }
.admin-list-item { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; }
.admin-list-photo { width: 36px; height: 36px; border-radius: 3px; overflow: hidden; background: var(--bg); display: flex; align-items: center; justify-content: center; flex: none; color: var(--ink-soft); }
.admin-list-photo img { width: 100%; height: 100%; object-fit: cover; }
.admin-list-info { flex: 1; font-size: 13px; }
.muted { color: var(--ink-soft); font-size: 12px; }
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
.stat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 14px; }
.stat-label { font-size: 11px; color: var(--ink-soft); }
.stat-value { font-size: 18px; font-weight: 700; margin-top: 4px; }
.stat-card.total-footer { font-size: 13px; }
.order-row { display: flex; justify-content: space-between; align-items: flex-start; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; font-size: 13px; gap: 10px; margin-bottom: 8px; }
.order-row-values { text-align: right; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.report-heading { font-family: 'Fraunces', serif; font-size: 15px; margin: 20px 0 10px; }
.report-table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; }
.report-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.report-table th { text-align: left; color: var(--ink-soft); font-weight: 500; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--bg); }
.report-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); }
.report-table tfoot td { font-weight: 600; background: var(--bg); border-top: 2px solid var(--line); border-bottom: none; }
.period-filter { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 12px; }
.ranking-box { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 14px; margin-top: 4px; }
.ranking-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.ranking-row:last-child { border-bottom: none; }
.pdf-actions { display: flex; flex-direction: column; gap: 8px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 24px; }
.modal-card { background: var(--surface); border-radius: 6px; padding: 24px; width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 12px; }
.modal-title { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; }
.modal-sub { font-size: 13px; color: var(--ink-soft); }
.modal-qty-input { font-size: 22px; text-align: center; padding: 14px; }
.modal-actions { display: flex; gap: 10px; }
.modal-actions .btn-secondary, .modal-actions .btn-primary { flex: 1; }
@media print {
  .no-print { display: none !important; }
  .app-root { background: #fff; }
}
`;

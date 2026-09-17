import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, Plus, Minus, Trash2, LogOut, Settings, Package, Store, Users, Receipt, Search, ImagePlus, ArrowLeft, Printer, MessageCircle, FileText, CheckCircle2 } from 'lucide-react';
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [pdfLibReady, setPdfLibReady] = useState(false);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [adminPin, setAdminPin] = useState('1234');

  const [screen, setScreen] = useState('login');
  const [loginTab, setLoginTab] = useState('vendor');
  const [loginStoreId, setLoginStoreId] = useState('');
  const [loginVendorId, setLoginVendorId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminPinInput, setAdminPinInput] = useState('');

  const [currentVendor, setCurrentVendor] = useState(null);
  const [cart, setCart] = useState([]);
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [checkout, setCheckout] = useState({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' });
  const [lastOrder, setLastOrder] = useState(null);
  const [adminTab, setAdminTab] = useState('produtos');

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
    (async () => {
      const load = async (key, fallback) => {
        try {
          const r = await storage.get(key);
          return r ? JSON.parse(r.value) : fallback;
        } catch { return fallback; }
      };
      const [s, v, p, o, pin] = await Promise.all([
        load('stores', []), load('vendors', []), load('products', []), load('orders', []), load('adminPin', '1234'),
      ]);
      setStores(s); setVendors(v); setProducts(p); setOrders(o); setAdminPin(pin);
      setReady(true);
    })();
  }, []);

  const persist = async (key, value) => {
    try { await storage.set(key, JSON.stringify(value)); } catch (e) { console.error(e); }
  };
  const updateStores = (list) => { setStores(list); persist('stores', list); };
  const updateVendors = (list) => { setVendors(list); persist('vendors', list); };
  const updateProducts = (list) => { setProducts(list); persist('products', list); };
  const updateOrders = (list) => { setOrders(list); persist('orders', list); };
  const updateAdminPin = (pin) => { setAdminPin(pin); persist('adminPin', pin); };

  const storeVendors = useMemo(() => vendors.filter(v => v.storeId === loginStoreId), [vendors, loginStoreId]);

  const doVendorLogin = () => {
    const vendor = vendors.find(v => v.id === loginVendorId);
    if (!vendor) { setLoginError('Selecione um vendedor.'); return; }
    if ((vendor.pin || '') !== loginPin) { setLoginError('PIN incorreto.'); return; }
    setCurrentVendor(vendor); setCart([]); setLoginError(''); setScreen('catalog');
  };
  const doAdminLogin = () => {
    if (adminPinInput === adminPin) { setScreen('admin'); setLoginError(''); }
    else { setLoginError('PIN de administrador incorreto.'); }
  };
  const logout = () => {
    setCurrentVendor(null); setCart([]); setScreen('login');
    setLoginStoreId(''); setLoginVendorId(''); setLoginPin('');
  };

  const addToCart = (productId) => {
    setCart(prev => {
      const existing = prev.find(i => i.productId === productId);
      if (existing) return prev.map(i => i.productId === productId ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { productId, qty: 1, discountPercent: 0 }];
    });
  };
  const setQty = (productId, qty) => {
    setCart(prev => qty <= 0 ? prev.filter(i => i.productId !== productId) : prev.map(i => i.productId === productId ? { ...i, qty } : i));
  };
  const setItemDiscount = (productId, value) => {
    setCart(prev => prev.map(i => i.productId === productId ? { ...i, discountPercent: value } : i));
  };
  const removeFromCart = (productId) => setCart(prev => prev.filter(i => i.productId !== productId));

  const cartDetailed = cart.map(i => {
    const p = products.find(pr => pr.id === i.productId);
    if (!p) return null;
    const discPercent = clampPercent(i.discountPercent);
    const lineTotal = p.price * i.qty * (1 - discPercent / 100);
    return { ...i, product: p, discPercent, lineTotal };
  }).filter(Boolean);
  const cartSubtotal = cartDetailed.reduce((sum, i) => sum + i.lineTotal, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const generalDiscountPercent = clampPercent(checkout.descontoGeral);
  const cartTotal = cartSubtotal * (1 - generalDiscountPercent / 100);

  const salvarOrcamento = () => {
    if (!checkout.nome.trim()) return;
    const store = stores.find(s => s.id === currentVendor.storeId);
    const commissionStoreValue = cartTotal * ((store?.commissionPercent || 0) / 100);
    const commissionVendorValue = cartTotal * ((currentVendor?.commissionPercent || 0) / 100);
    const order = {
      id: uid(), createdAt: new Date().toISOString(),
      vendorId: currentVendor.id, vendorName: currentVendor.name,
      storeId: currentVendor.storeId, storeName: store?.name || '',
      cliente: { ...checkout },
      items: cartDetailed.map(i => ({ productId: i.product.id, name: i.product.name, price: i.product.price, qty: i.qty, discountPercent: i.discPercent })),
      subtotal: cartSubtotal,
      generalDiscountPercent,
      total: cartTotal,
      commissionStorePercent: store?.commissionPercent || 0,
      commissionVendorPercent: currentVendor?.commissionPercent || 0,
      commissionStoreValue, commissionVendorValue,
      status: 'orcamento',
      convertedAt: null,
    };
    updateOrders([order, ...orders]);
    setLastOrder(order); setCart([]); setCheckout({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' });
    setScreen('orderSummary');
  };

  const convertToPedido = (orderId) => {
    const now = new Date().toISOString();
    updateOrders(orders.map(o => o.id === orderId ? { ...o, status: 'pedido', convertedAt: now } : o));
    if (lastOrder && lastOrder.id === orderId) setLastOrder({ ...lastOrder, status: 'pedido', convertedAt: now });
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
      y += 7;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 2;
    doc.line(14, y, 196, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Subtotal: ${currency(order.subtotal)}`, 140, y); y += 6;
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
        return `${i.qty}x ${i.name}${descTxt} - ${currency(lineTotal)}`;
      }),
      '',
      order.generalDiscountPercent ? `Desconto geral: ${order.generalDiscountPercent}%` : null,
      `*Total: ${currency(order.total)}*`,
      order.cliente.obs ? `Obs: ${order.cliente.obs}` : null,
    ].filter(Boolean).join('\n');
    return `https://wa.me/?text=${encodeURIComponent(lines)}`;
  };

  if (!ready) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Carregando…</div>;

  return (
    <div className="app-root">
      <style>{STYLES}</style>
      {screen === 'login' && (
        <LoginScreen {...{ loginTab, setLoginTab, stores, storeVendors, loginStoreId, setLoginStoreId, loginVendorId, setLoginVendorId, loginPin, setLoginPin, doVendorLogin, adminPinInput, setAdminPinInput, doAdminLogin, loginError }} />
      )}
      {screen === 'catalog' && currentVendor && (
        <CatalogScreen {...{ currentVendor, stores, products, activeCategory, setActiveCategory, search, setSearch, addToCart, cartCount, cartTotal, setScreen, logout }} />
      )}
      {screen === 'cart' && (
        <CartScreen {...{ cartDetailed, setQty, setItemDiscount, removeFromCart, cartSubtotal, setScreen }} />
      )}
      {screen === 'checkout' && (
        <CheckoutScreen {...{ checkout, setCheckout, cartSubtotal, generalDiscountPercent, cartTotal, salvarOrcamento, setScreen }} />
      )}
      {screen === 'orderSummary' && lastOrder && (
        <OrderSummaryScreen {...{ order: lastOrder, waLink, setScreen, generatePDF, pdfLibReady, convertToPedido }} />
      )}
      {screen === 'quotes' && currentVendor && (
        <QuotesScreen {...{ orders: orders.filter(o => o.vendorId === currentVendor.id), convertToPedido, setScreen }} />
      )}
      {screen === 'admin' && (
        <AdminScreen {...{ stores, vendors, products, orders, updateStores, updateVendors, updateProducts, adminTab, setAdminTab, adminPin, updateAdminPin, setScreen, pdfLibReady, convertToPedido }} />
      )}
    </div>
  );
}

function LoginScreen({ loginTab, setLoginTab, stores, storeVendors, loginStoreId, setLoginStoreId, loginVendorId, setLoginVendorId, loginPin, setLoginPin, doVendorLogin, adminPinInput, setAdminPinInput, doAdminLogin, loginError }) {
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
          <button className={loginTab === 'admin' ? 'tab active' : 'tab'} onClick={() => setLoginTab('admin')}>Administração</button>
        </div>
        {loginTab === 'vendor' ? (
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
        ) : (
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

function CatalogScreen({ currentVendor, stores, products, activeCategory, setActiveCategory, search, setSearch, addToCart, cartCount, cartTotal, setScreen, logout }) {
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
              <button className="add-btn" onClick={() => addToCart(p.id)}><Plus size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {cartCount > 0 && (
        <div className="floating-cart" onClick={() => setScreen('cart')}>
          <span>{cartCount} item{cartCount > 1 ? 's' : ''} no carrinho</span>
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
        <button className="icon-btn" onClick={() => setScreen('catalog')}><ArrowLeft size={18} /></button>
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
                  <span>{i.qty}</span>
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

function CheckoutScreen({ checkout, setCheckout, cartSubtotal, generalDiscountPercent, cartTotal, salvarOrcamento, setScreen }) {
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('cart')}><ArrowLeft size={18} /></button>
        <div className="topbar-title">Dados do cliente</div>
        <div style={{ width: 34 }} />
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
        {generalDiscountPercent > 0 && <div className="cart-total-row muted-row"><span>Desconto geral ({generalDiscountPercent}%)</span><span>- {currency(cartSubtotal - cartTotal)}</span></div>}
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
        <button className="icon-btn" onClick={() => setScreen('catalog')}><ArrowLeft size={18} /></button>
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
              return <tr key={i.productId}><td>{i.name}</td><td>{i.qty}</td><td>{i.discountPercent || 0}%</td><td>{currency(lineTotal)}</td></tr>;
            })}
          </tbody>
        </table>
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
        <button className="icon-btn" onClick={() => setScreen('catalog')}><ArrowLeft size={18} /></button>
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

function AdminScreen({ stores, vendors, products, orders, updateStores, updateVendors, updateProducts, adminTab, setAdminTab, adminPin, updateAdminPin, setScreen, pdfLibReady, convertToPedido }) {
  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-title">Administração</div>
        <button className="icon-btn" onClick={() => setScreen('login')}><LogOut size={18} /></button>
      </header>
      <div className="tabs wrap">
        <button className={adminTab === 'produtos' ? 'tab active' : 'tab'} onClick={() => setAdminTab('produtos')}><Package size={14} /> Produtos</button>
        <button className={adminTab === 'lojas' ? 'tab active' : 'tab'} onClick={() => setAdminTab('lojas')}><Store size={14} /> Lojas</button>
        <button className={adminTab === 'vendedores' ? 'tab active' : 'tab'} onClick={() => setAdminTab('vendedores')}><Users size={14} /> Vendedores</button>
        <button className={adminTab === 'pedidos' ? 'tab active' : 'tab'} onClick={() => setAdminTab('pedidos')}><Receipt size={14} /> Orçamentos/Pedidos</button>
        <button className={adminTab === 'config' ? 'tab active' : 'tab'} onClick={() => setAdminTab('config')}><Settings size={14} /> Config</button>
      </div>
      <div className="admin-body">
        {adminTab === 'produtos' && <ProductsAdmin products={products} updateProducts={updateProducts} />}
        {adminTab === 'lojas' && <StoresAdmin stores={stores} updateStores={updateStores} />}
        {adminTab === 'vendedores' && <VendorsAdmin vendors={vendors} stores={stores} updateVendors={updateVendors} />}
        {adminTab === 'pedidos' && <OrdersAdmin orders={orders} stores={stores} vendors={vendors} pdfLibReady={pdfLibReady} convertToPedido={convertToPedido} />}
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
    if (editingId) updateProducts(products.map(p => p.id === editingId ? { ...payload, id: editingId } : p));
    else updateProducts([...products, { ...payload, id: uid() }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (p) => { setForm({ ...empty, ...p, price: String(p.price) }); setEditingId(p.id); };
  const remove = (id) => updateProducts(products.filter(p => p.id !== id));

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

function StoresAdmin({ stores, updateStores }) {
  const empty = { id: null, name: '', commissionPercent: '' };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (!form.name.trim()) return;
    if (editingId) updateStores(stores.map(s => s.id === editingId ? { ...form, id: editingId, commissionPercent: Number(form.commissionPercent) || 0 } : s));
    else updateStores([...stores, { ...form, id: uid(), commissionPercent: Number(form.commissionPercent) || 0 }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (s) => { setForm({ ...s, commissionPercent: String(s.commissionPercent) }); setEditingId(s.id); };
  const remove = (id) => updateStores(stores.filter(s => s.id !== id));
  return (
    <div>
      <div className="admin-form">
        <label>Nome da loja
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Loja Centro" />
        </label>
        <label>Comissão da loja (%)
          <input type="number" step="0.1" value={form.commissionPercent} onChange={e => setForm({ ...form, commissionPercent: e.target.value })} placeholder="Ex: 3" />
        </label>
        <div className="admin-form-actions">
          <button className="btn-primary" onClick={save}>{editingId ? 'Salvar alterações' : 'Adicionar loja'}</button>
          {editingId && <button className="btn-secondary" onClick={() => { setForm(empty); setEditingId(null); }}>Cancelar</button>}
        </div>
      </div>
      <div className="admin-list">
        {stores.map(s => (
          <div key={s.id} className="admin-list-item">
            <div className="admin-list-info"><div>{s.name}</div><div className="muted">Comissão: {s.commissionPercent}%</div></div>
            <button className="icon-btn" onClick={() => edit(s)}>✎</button>
            <button className="icon-btn" onClick={() => remove(s.id)}><Trash2 size={16} /></button>
          </div>
        ))}
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
    if (editingId) updateVendors(vendors.map(v => v.id === editingId ? { ...form, id: editingId, commissionPercent: Number(form.commissionPercent) || 0 } : v));
    else updateVendors([...vendors, { ...form, id: uid(), commissionPercent: Number(form.commissionPercent) || 0 }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (v) => { setForm({ ...v, commissionPercent: String(v.commissionPercent) }); setEditingId(v.id); };
  const remove = (id) => updateVendors(vendors.filter(v => v.id !== id));
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
  const totalVendas = pedidos.reduce((s, o) => s + o.total, 0);
  const totalComissaoLoja = pedidos.reduce((s, o) => s + o.commissionStoreValue, 0);
  const totalComissaoVendedor = pedidos.reduce((s, o) => s + o.commissionVendorValue, 0);
  const totalOrcamentos = orcamentosPendentes.reduce((s, o) => s + o.total, 0);

  const downloadReport = () => {
    if (!window.jspdf) return;
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
    doc.save('relatorio-comissoes.pdf');
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
        <button className="btn-secondary" disabled={!pdfLibReady} onClick={downloadReport}>
          <Printer size={16} /> {pdfLibReady ? 'Baixar relatório em PDF' : 'Preparando gerador de PDF…'}
        </button>
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

function ConfigAdmin({ adminPin, updateAdminPin }) {
  const [pin, setPin] = useState(adminPin);
  return (
    <div className="admin-form">
      <label>PIN de administrador
        <input value={pin} onChange={e => setPin(e.target.value)} maxLength={8} />
      </label>
      <button className="btn-primary" onClick={() => updateAdminPin(pin)}>Salvar PIN</button>
      <p className="hint">Este PIN dá acesso à área de administração (produtos, lojas, vendedores e comissões). A segurança aqui é simples, sem criptografia — guarde-o com os administradores de confiança.</p>
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
.topbar-title { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.topbar-sub { font-size: 12px; color: var(--ink-soft); }
.topbar-actions { display: flex; gap: 8px; align-items: center; }
.icon-btn { background: none; border: 1px solid var(--line); width: 34px; height: 34px; border-radius: 3px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--ink); }
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
.qty-control span { min-width: 18px; text-align: center; font-size: 13px; font-weight: 600; }
.cart-summary { padding: 16px; border-top: 1px solid var(--line); background: var(--surface); display: flex; flex-direction: column; gap: 12px; }
.cart-total-row { display: flex; justify-content: space-between; align-items: center; font-size: 15px; padding: 8px 0; }
.cart-total-row.muted-row { font-size: 13px; color: var(--ink-soft); padding: 0; }
.printable { background: var(--surface); margin: 16px; padding: 24px; border: 1px solid var(--line); border-radius: 4px; }
.printable .muted { color: var(--ink-soft); font-size: 13px; margin: 4px 0 0; }
.divider { height: 1px; background: var(--line); margin: 16px 0; }
.order-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.order-table th { text-align: left; color: var(--ink-soft); font-weight: 500; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.order-table td { padding: 8px 0; border-bottom: 1px solid var(--line); }
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
.order-row { display: flex; justify-content: space-between; align-items: flex-start; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; font-size: 13px; gap: 10px; margin-bottom: 8px; }
.order-row-values { text-align: right; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
@media print {
  .no-print { display: none !important; }
  .app-root { background: #fff; }
}
`;

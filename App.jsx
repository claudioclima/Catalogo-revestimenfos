import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, Plus, Minus, Trash2, LogOut, Settings, Package, Store, Users, Receipt, Search, ImagePlus, ArrowLeft, Printer, MessageCircle, FileText, CheckCircle2, BarChart3, UserCog, RefreshCw, Home, TrendingUp, Calendar, User, Handshake, Briefcase, ShieldCheck, Weight } from 'lucide-react';
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

function resizeLogo(file, maxW = 400, quality = 0.85) {
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
        resolve({ dataUrl: canvas.toDataURL('image/png', quality), width: canvas.width, height: canvas.height });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addLetterhead(doc, branding) {
  let y = 20;
  if (branding?.logo) {
    const maxW = 28;
    const ratio = (branding.logoW && branding.logoH) ? (branding.logoH / branding.logoW) : 1;
    const w = maxW;
    const h = Math.min(22, maxW * ratio);
    try { doc.addImage(branding.logo, 'PNG', 14, 10, w, h); } catch (e) { /* ignore malformed image */ }
    y = Math.max(y, 12 + h + 8);
    if (branding.companyName) {
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(branding.companyName, 14 + w + 6, 10 + h / 2 + 3);
      doc.setTextColor(0);
    }
    doc.setDrawColor(220);
    doc.line(14, y - 4, doc.internal.pageSize.getWidth() - 14, y - 4);
    doc.setDrawColor(0);
  } else if (branding?.companyName) {
    doc.setFontSize(11);
    doc.text(branding.companyName, 14, 16);
    y = 24;
  }
  return y;
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

function orderTotalWeight(order) {
  return (order.items || []).reduce((sum, i) => sum + (i.peso ? Number(i.peso) * i.qty : 0), 0);
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

function generateOrderNumber(store, allOrders) {
  const year = new Date().getFullYear();
  const lettersOnly = (store?.name || 'XX').toUpperCase().replace(/[^A-Z]/g, '');
  const prefix = (lettersOnly.slice(0, 2) || 'XX').padEnd(2, 'X');
  const yearPrefix = `${prefix}-${year}-`;
  const seqNums = allOrders
    .filter(o => o.storeId === store?.id && o.numero && o.numero.startsWith(yearPrefix))
    .map(o => parseInt(o.numero.slice(yearPrefix.length), 10))
    .filter(n => !isNaN(n));
  const next = (seqNums.length ? Math.max(...seqNums) : 0) + 1;
  return `${yearPrefix}${String(next).padStart(4, '0')}`;
}

function getMissingFields(order) {
  const missing = [];
  if (!order.cliente?.nome?.trim()) missing.push('nome do cliente');
  if (!order.cliente?.telefone?.trim()) missing.push('telefone do cliente');
  if (!order.cliente?.endereco?.trim()) missing.push('endereço do cliente');
  if (!order.items || order.items.length === 0) missing.push('itens do pedido');
  return missing;
}

function drawPdfTable(doc, x0, y0, columns, rows) {
  const bottom = doc.internal.pageSize.getHeight() - 20;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  let y = y0;
  const drawHeader = () => {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    let x = x0;
    columns.forEach(col => {
      if (col.align === 'right') doc.text(col.label, x + col.width, y, { align: 'right' });
      else doc.text(col.label, x, y);
      x += col.width;
    });
    doc.setFont(undefined, 'normal');
    y += 2;
    doc.line(x0, y, x0 + totalWidth, y);
    y += 6;
  };
  drawHeader();
  doc.setFontSize(9);
  rows.forEach(row => {
    let x = x0;
    columns.forEach((col, i) => {
      let val = row[i] == null ? '' : String(row[i]);
      if (col.maxChars) val = val.slice(0, col.maxChars);
      if (col.align === 'right') doc.text(val, x + col.width, y, { align: 'right' });
      else doc.text(val, x, y);
      x += col.width;
    });
    y += 7;
    if (y > bottom) { doc.addPage(); y = 20; drawHeader(); }
  });
  return y;
}

function periodLabel(period, customFrom, customTo) {
  if (period === 'dia') return 'Hoje';
  if (period === 'semana') return 'Esta semana';
  if (period === 'mes') return 'Este mês';
  if (period === 'periodo') return `${customFrom || 'início'} até ${customTo || 'hoje'}`;
  return 'Todo o histórico';
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

const STORAGE_KEYS = { stores: 'stores', vendors: 'vendors', representantes: 'representantes', gerentes: 'gerentes', products: 'products', orders: 'orders', adminPin: 'adminPin', branding: 'branding' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [pdfLibReady, setPdfLibReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [representantes, setRepresentantes] = useState([]);
  const [gerentes, setGerentes] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [adminPin, setAdminPin] = useState('1234');
  const [branding, setBranding] = useState({ logo: '', logoW: 0, logoH: 0, companyName: '' });

  const [screen, setScreen] = useState('login');
  const [loginTab, setLoginTab] = useState('vendor');
  const [loginStoreId, setLoginStoreId] = useState('');
  const [loginVendorId, setLoginVendorId] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginRepId, setLoginRepId] = useState('');
  const [loginRepPin, setLoginRepPin] = useState('');
  const [loginGerId, setLoginGerId] = useState('');
  const [loginGerPin, setLoginGerPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminPinInput, setAdminPinInput] = useState('');

  const [currentVendor, setCurrentVendor] = useState(null);
  const [currentRepresentante, setCurrentRepresentante] = useState(null);
  const [currentGerente, setCurrentGerente] = useState(null);
  const [cart, setCart] = useState([]);
  const [qtyPromptProductId, setQtyPromptProductId] = useState(null);
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [checkout, setCheckout] = useState({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' });
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [orderSummaryBack, setOrderSummaryBack] = useState('catalog');
  const [adminTab, setAdminTab] = useState('produtos');

  const loadKey = async (key, fallback) => {
    try {
      const r = await storage.get(key);
      return r ? JSON.parse(r.value) : fallback;
    } catch { return fallback; }
  };

  const loadProducts = async () => {
    const ids = await loadKey('productIndex', null);
    if (ids === null) {
      // Primeira vez com o novo formato: migra os produtos que já existiam na gaveta única.
      const legacy = await loadKey(STORAGE_KEYS.products, []);
      if (legacy.length) {
        const newIds = legacy.map(p => p.id);
        await Promise.all(legacy.map(p => storage.set(`product:${p.id}`, JSON.stringify(p)).catch(() => {})));
        await storage.set('productIndex', JSON.stringify(newIds)).catch(() => {});
        return legacy;
      }
      await storage.set('productIndex', JSON.stringify([])).catch(() => {});
      return [];
    }
    const results = await Promise.all(ids.map(id => loadKey(`product:${id}`, null)));
    return results.filter(Boolean);
  };

  const refreshAll = async () => {
    setRefreshing(true);
    const [s, v, rep, ger, p, o, pin, br] = await Promise.all([
      loadKey(STORAGE_KEYS.stores, []), loadKey(STORAGE_KEYS.vendors, []), loadKey(STORAGE_KEYS.representantes, []), loadKey(STORAGE_KEYS.gerentes, []),
      loadProducts(), loadKey(STORAGE_KEYS.orders, []), loadKey(STORAGE_KEYS.adminPin, '1234'), loadKey(STORAGE_KEYS.branding, { logo: '', logoW: 0, logoH: 0, companyName: '' }),
    ]);
    setStores(s); setVendors(v); setRepresentantes(rep); setGerentes(ger); setProducts(p); setOrders(o); setAdminPin(pin); setBranding(br);
    setRefreshing(false);
    return { s, v, rep, ger, p, o, pin, br };
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
    if (ready && (screen === 'admin' || screen === 'repDashboard' || screen === 'gerenteDashboard')) { refreshAll(); }
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
  const mutateGerentes = (updater) => mutate(STORAGE_KEYS.gerentes, updater, setGerentes);
  const saveProduct = async (product) => {
    try { await storage.set(`product:${product.id}`, JSON.stringify(product)); } catch (e) { console.error(e); }
    const idx = await loadKey('productIndex', []);
    if (!idx.includes(product.id)) {
      try { await storage.set('productIndex', JSON.stringify([...idx, product.id])); } catch (e) { console.error(e); }
    }
    setProducts(current => {
      const exists = current.some(p => p.id === product.id);
      return exists ? current.map(p => p.id === product.id ? product : p) : [...current, product];
    });
  };
  const deleteProductById = async (id) => {
    const idx = await loadKey('productIndex', []);
    try { await storage.set('productIndex', JSON.stringify(idx.filter(x => x !== id))); } catch (e) { console.error(e); }
    setProducts(current => current.filter(p => p.id !== id));
  };
  const mutateOrders = (updater) => mutate(STORAGE_KEYS.orders, updater, setOrders);
  const mutateAdminPin = (pin) => { setAdminPin(pin); storage.set(STORAGE_KEYS.adminPin, JSON.stringify(pin)).catch(() => {}); };
  const updateBranding = (next) => { setBranding(next); storage.set(STORAGE_KEYS.branding, JSON.stringify(next)).catch(() => {}); };

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
  const doGerenteLogin = async () => {
    const { ger } = await refreshAll();
    const g = ger.find(x => x.id === loginGerId);
    if (!g) { setLoginError('Selecione um gerente.'); return; }
    if ((g.pin || '') !== loginGerPin) { setLoginError('PIN incorreto.'); return; }
    setCurrentGerente(g); setLoginError(''); setScreen('gerenteDashboard');
  };
  const doAdminLogin = () => {
    if (adminPinInput === adminPin) { setScreen('admin'); setLoginError(''); }
    else { setLoginError('PIN de administrador incorreto.'); }
  };
  const logout = () => {
    setCurrentVendor(null); setCurrentRepresentante(null); setCurrentGerente(null); setCart([]); setEditingOrderId(null); setScreen('login');
    setLoginStoreId(''); setLoginVendorId(''); setLoginPin(''); setLoginRepId(''); setLoginRepPin(''); setLoginGerId(''); setLoginGerPin('');
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
    const isEdit = !!editingOrderId;
    const newId = isEdit ? editingOrderId : uid();
    const baseFields = {
      id: newId,
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
    const next = await mutateOrders(current => {
      if (isEdit) {
        const existing = current.find(o => o.id === editingOrderId);
        const finalOrder = { ...baseFields, numero: existing?.numero || generateOrderNumber(store, current), createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
        return current.map(o => o.id === editingOrderId ? finalOrder : o);
      }
      const finalOrder = { ...baseFields, numero: generateOrderNumber(store, current), createdAt: new Date().toISOString(), updatedAt: null };
      return [finalOrder, ...current];
    });
    const saved = next.find(o => o.id === newId);
    setLastOrder(saved); setCart([]); setCheckout({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' }); setEditingOrderId(null);
    setOrderSummaryBack('catalog');
    setScreen('orderSummary');
  };

  const startEditOrder = (order) => {
    setEditingOrderId(order.id);
    setCart(order.items.map(i => ({ productId: i.productId, qty: i.qty, discountPercent: i.discountPercent || 0 })));
    setCheckout({ nome: order.cliente?.nome || '', telefone: order.cliente?.telefone || '', endereco: order.cliente?.endereco || '', obs: order.cliente?.obs || '', descontoGeral: order.generalDiscountPercent ? String(order.generalDiscountPercent) : '' });
    setScreen('cart');
  };
  const cancelEdit = () => { setEditingOrderId(null); setCart([]); setCheckout({ nome: '', telefone: '', endereco: '', obs: '', descontoGeral: '' }); };

  const openOrderView = (order, backScreen) => {
    setLastOrder(order); setOrderSummaryBack(backScreen); setScreen('orderSummary');
  };

  const convertToPedido = async (orderId) => {
    const now = new Date().toISOString();
    const next = await mutateOrders(current => current.map(o => o.id === orderId ? { ...o, status: 'pedido', convertedAt: now } : o));
    if (lastOrder && lastOrder.id === orderId) {
      const updated = next.find(o => o.id === orderId);
      if (updated) setLastOrder(updated);
    }
  };

  const deleteOrder = async (orderId) => {
    await mutateOrders(current => current.filter(o => o.id !== orderId));
  };

  const generatePDF = (order) => {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = addLetterhead(doc, branding);
    const titulo = order.status === 'pedido' ? 'Pedido' : 'Orçamento';
    doc.setFontSize(16);
    doc.text(`${titulo} - ${order.storeName}`, 14, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Nº: ${order.numero || '—'}`, 14, y); y += 6;
    doc.text(`Vendedor: ${order.vendorName}`, 14, y); y += 6;
    doc.text(`Data: ${new Date(order.createdAt).toLocaleString('pt-BR')}`, 14, y); y += 10;
    doc.text(`Cliente: ${order.cliente.nome}`, 14, y); y += 6;
    if (order.cliente.telefone) { doc.text(`Telefone: ${order.cliente.telefone}`, 14, y); y += 6; }
    if (order.cliente.endereco) { doc.text(`Endereço: ${order.cliente.endereco}`, 14, y); y += 6; }
    y += 4;
    const itemCols = [
      { label: 'Produto', width: 78, maxChars: 42 },
      { label: 'Qtd', width: 16, align: 'right' },
      { label: 'Desc.', width: 18, align: 'right' },
      { label: 'Preço', width: 30, align: 'right' },
      { label: 'Subtotal', width: 32, align: 'right' },
    ];
    const rows = order.items.map(i => {
      const lineTotal = i.price * i.qty * (1 - (i.discountPercent || 0) / 100);
      return [i.name, i.qty, `${i.discountPercent || 0}%`, currency(i.price), currency(lineTotal)];
    });
    y = drawPdfTable(doc, 14, y, itemCols, rows);
    const specLines = order.items.map(packagingLine).filter(Boolean);
    if (specLines.length) {
      doc.setFontSize(8);
      doc.setTextColor(120);
      specLines.forEach(line => {
        doc.text(line, 14, y); y += 5;
        if (y > 270) { doc.addPage(); y = 20; }
      });
      doc.setTextColor(0);
      doc.setFontSize(10);
      y += 1;
    }
    y += 2;
    doc.line(14, y, 196, y); y += 8;
    doc.setFontSize(10);
    doc.text(`Subtotal: ${currency(order.subtotal)}`, 140, y); y += 6;
    if (order.descontoRevendaPercent) { doc.text(`Desconto revenda: ${order.descontoRevendaPercent}%`, 140, y); y += 6; }
    if (order.generalDiscountPercent) { doc.text(`Desconto geral: ${order.generalDiscountPercent}%`, 140, y); y += 6; }
    const totalWeight = orderTotalWeight(order);
    if (totalWeight > 0) { doc.text(`Peso total: ${totalWeight.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`, 140, y); y += 6; }
    doc.setFontSize(13);
    doc.text(`Total: ${currency(order.total)}`, 140, y);
    if (order.cliente.obs) { y += 10; doc.setFontSize(10); doc.text(`Obs: ${order.cliente.obs}`, 14, y); }
    doc.save(`${titulo.toLowerCase()}-${(order.cliente.nome || 'cliente').replace(/\s+/g, '-').toLowerCase()}.pdf`);
  };

  const waLink = (order) => {
    const titulo = order.status === 'pedido' ? 'Pedido' : 'Orçamento';
    const lines = [
      `*${titulo} nº ${order.numero || '—'}*`,
      `Loja: ${order.storeName}`,
      `Vendedor: ${order.vendorName}`,
      `Valor: ${currency(order.total)}`,
      '',
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
      orderTotalWeight(order) > 0 ? `Peso total: ${orderTotalWeight(order).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg` : null,
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
        <LoginScreen {...{ loginTab, setLoginTab, stores, storeVendors, loginStoreId, setLoginStoreId, loginVendorId, setLoginVendorId, loginPin, setLoginPin, doVendorLogin, representantes, loginRepId, setLoginRepId, loginRepPin, setLoginRepPin, doRepresentanteLogin, gerentes, loginGerId, setLoginGerId, loginGerPin, setLoginGerPin, doGerenteLogin, adminPinInput, setAdminPinInput, doAdminLogin, loginError, setLoginError, branding }} />
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
        <CartScreen {...{ cartDetailed, setQty: (id, qty) => confirmQuantity(id, qty), setItemDiscount, removeFromCart, cartSubtotal, setScreen, editingOrderId, cancelEdit }} />
      )}
      {screen === 'checkout' && (
        <CheckoutScreen {...{ checkout, setCheckout, cartSubtotal, descontoRevendaPercent, afterResale, generalDiscountPercent, cartTotal, salvarOrcamento, setScreen, editingOrderId, cancelEdit }} />
      )}
      {screen === 'orderSummary' && lastOrder && (
        <OrderSummaryScreen {...{ order: lastOrder, waLink, setScreen, generatePDF, pdfLibReady, convertToPedido, backScreen: orderSummaryBack, onEdit: startEditOrder }} />
      )}
      {screen === 'quotes' && currentVendor && (
        <QuotesScreen {...{ orders: orders.filter(o => o.vendorId === currentVendor.id), convertToPedido, setScreen, onOpenOrder: (o) => openOrderView(o, 'quotes') }} />
      )}
      {screen === 'myOrders' && currentVendor && (
        <MyOrdersScreen {...{ orders: orders.filter(o => o.vendorId === currentVendor.id), setScreen, onOpenOrder: (o) => openOrderView(o, 'myOrders') }} />
      )}
      {screen === 'myReport' && currentVendor && (
        <MyReportScreen {...{ orders: orders.filter(o => o.vendorId === currentVendor.id), setScreen, pdfLibReady, onOpenOrder: (o) => openOrderView(o, 'myReport'), branding }} />
      )}
      {screen === 'repDashboard' && currentRepresentante && (
        <RepresentanteScreen {...{ currentRepresentante, stores, vendors, orders, logout, refreshAll, refreshing, pdfLibReady, onOpenOrder: (o) => openOrderView(o, 'repDashboard'), branding }} />
      )}
      {screen === 'gerenteDashboard' && currentGerente && (
        <GerenteScreen {...{ currentGerente, stores, vendors, orders, logout, refreshAll, refreshing, pdfLibReady, onOpenOrder: (o) => openOrderView(o, 'gerenteDashboard'), branding }} />
      )}
      {screen === 'admin' && (
        <AdminScreen {...{ stores, vendors, representantes, gerentes, products, orders, updateStores: mutateStores, updateVendors: mutateVendors, updateRepresentantes: mutateRepresentantes, updateGerentes: mutateGerentes, saveProduct, deleteProductById, adminTab, setAdminTab, adminPin, updateAdminPin: mutateAdminPin, branding, updateBranding, setScreen, pdfLibReady, convertToPedido, deleteOrder, refreshAll, refreshing, onOpenOrder: (o) => openOrderView(o, 'admin') }} />
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

function LoginScreen({ loginTab, setLoginTab, stores, storeVendors, loginStoreId, setLoginStoreId, loginVendorId, setLoginVendorId, loginPin, setLoginPin, doVendorLogin, representantes, loginRepId, setLoginRepId, loginRepPin, setLoginRepPin, doRepresentanteLogin, gerentes, loginGerId, setLoginGerId, loginGerPin, setLoginGerPin, doGerenteLogin, adminPinInput, setAdminPinInput, doAdminLogin, loginError, setLoginError, branding }) {
  const switchTab = (tab) => { setLoginTab(tab); setLoginError(''); };
  return (
    <div className="screen-center">
      <div className="login-card">
        <div className="login-header">
          {branding?.logo ? <img src={branding.logo} alt="" className="login-logo" /> : <div className="tile-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>}
          <h1>Catálogo de Revestimentos</h1>
          <p>Acesso para consultores de vendas</p>
        </div>
        <div className="tabs login-tabs">
          <button className={loginTab === 'vendor' ? 'tab active' : 'tab'} onClick={() => switchTab('vendor')}><User size={20} /><span>Vendedor</span></button>
          <button className={loginTab === 'rep' ? 'tab active' : 'tab'} onClick={() => switchTab('rep')}><Handshake size={20} /><span>Representante</span></button>
          <button className={loginTab === 'ger' ? 'tab active' : 'tab'} onClick={() => switchTab('ger')}><Briefcase size={20} /><span>Gerente</span></button>
          <button className={loginTab === 'admin' ? 'tab active' : 'tab'} onClick={() => switchTab('admin')}><ShieldCheck size={20} /><span>Admin</span></button>
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
        {loginTab === 'ger' && (
          <div className="form-stack">
            <label>Gerente
              <select value={loginGerId} onChange={e => setLoginGerId(e.target.value)}>
                <option value="">Selecione seu nome</option>
                {gerentes.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label>PIN
              <input type="password" inputMode="numeric" maxLength={6} value={loginGerPin} onChange={e => setLoginGerPin(e.target.value)} placeholder="••••" />
            </label>
            {loginError && <div className="error">{loginError}</div>}
            <button className="btn-primary" onClick={doGerenteLogin}>Entrar</button>
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
          <button className="icon-btn" onClick={() => setScreen('myOrders')} title="Meus pedidos"><Receipt size={18} /></button>
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

function CartScreen({ cartDetailed, setQty, setItemDiscount, removeFromCart, cartSubtotal, setScreen, editingOrderId, cancelEdit }) {
  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        </div>
        <div className="topbar-title">Carrinho</div>
        <div style={{ width: 34 }} />
      </header>
      {editingOrderId && (
        <div className="edit-banner">Editando orçamento existente · <button onClick={() => { cancelEdit(); setScreen('catalog'); }}>Cancelar edição</button></div>
      )}
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
            <button className="btn-primary" onClick={() => setScreen('checkout')}>{editingOrderId ? 'Continuar edição' : 'Finalizar orçamento'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function CheckoutScreen({ checkout, setCheckout, cartSubtotal, descontoRevendaPercent, afterResale, generalDiscountPercent, cartTotal, salvarOrcamento, setScreen, editingOrderId, cancelEdit }) {
  const nomeRef = useRef(null);
  const telefoneRef = useRef(null);
  const enderecoRef = useRef(null);
  const descontoRef = useRef(null);
  const obsRef = useRef(null);
  const goNext = (nextRef) => (e) => { if (e.key === 'Enter') { e.preventDefault(); nextRef.current && nextRef.current.focus(); } };
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">Dados do cliente</div>
        <button className="icon-btn" onClick={() => setScreen('cart')}><ArrowLeft size={18} /></button>
      </header>
      {editingOrderId && (
        <div className="edit-banner">Editando orçamento existente · <button onClick={() => { cancelEdit(); setScreen('catalog'); }}>Cancelar edição</button></div>
      )}
      <div className="form-stack pad">
        <label>Nome do cliente *
          <input ref={nomeRef} className="input-lg" value={checkout.nome} onChange={e => setCheckout({ ...checkout, nome: e.target.value })} onKeyDown={goNext(telefoneRef)} enterKeyHint="next" placeholder="Nome completo" />
        </label>
        <label>Telefone / WhatsApp
          <input ref={telefoneRef} className="input-lg" type="tel" inputMode="tel" value={checkout.telefone} onChange={e => setCheckout({ ...checkout, telefone: e.target.value })} onKeyDown={goNext(enderecoRef)} enterKeyHint="next" placeholder="(00) 00000-0000" />
        </label>
        <label>Endereço de entrega
          <input ref={enderecoRef} className="input-lg" value={checkout.endereco} onChange={e => setCheckout({ ...checkout, endereco: e.target.value })} onKeyDown={goNext(descontoRef)} enterKeyHint="next" placeholder="Opcional" />
        </label>
        <p className="hint">Telefone e endereço podem ficar em branco por enquanto, mas serão obrigatórios para converter este orçamento em pedido.</p>
        <label>Desconto geral (%)
          <input ref={descontoRef} className="input-lg" type="number" inputMode="numeric" min="0" max="100" value={checkout.descontoGeral} onChange={e => setCheckout({ ...checkout, descontoGeral: e.target.value })} onKeyDown={goNext(obsRef)} enterKeyHint="next" placeholder="0" />
        </label>
        <label>Observações
          <textarea ref={obsRef} rows={3} className="input-lg" value={checkout.obs} onChange={e => setCheckout({ ...checkout, obs: e.target.value })} placeholder="Opcional" />
        </label>
        <div className="cart-total-row"><span>Subtotal</span><span>{currency(cartSubtotal)}</span></div>
        {descontoRevendaPercent > 0 && <div className="cart-total-row muted-row"><span>Desconto de revenda ({descontoRevendaPercent}%) — automático</span><span>- {currency(cartSubtotal - afterResale)}</span></div>}
        {generalDiscountPercent > 0 && <div className="cart-total-row muted-row"><span>Desconto geral ({generalDiscountPercent}%)</span><span>- {currency(afterResale - cartTotal)}</span></div>}
        <div className="cart-total-row"><span>Total do orçamento</span><strong>{currency(cartTotal)}</strong></div>
        <button className="btn-primary" disabled={!checkout.nome.trim()} onClick={salvarOrcamento}>{editingOrderId ? 'Salvar alterações' : 'Salvar orçamento'}</button>
      </div>
    </div>
  );
}

function OrderSummaryScreen({ order, waLink, setScreen, generatePDF, pdfLibReady, convertToPedido, backScreen = 'catalog', onEdit }) {
  const isPedido = order.status === 'pedido';
  const isVendorFlow = backScreen === 'catalog' || backScreen === 'quotes' || backScreen === 'myReport';
  return (
    <div className="screen">
      <header className="topbar no-print">
        <button className="icon-btn" onClick={() => setScreen(backScreen)} title="Voltar"><Home size={18} /></button>
        <div className="topbar-title">{isPedido ? 'Pedido confirmado' : 'Orçamento salvo'}</div>
        <div style={{ width: 34 }} />
      </header>
      <div className="printable">
        <div className={isPedido ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{isPedido ? 'Pedido' : 'Orçamento'}</div>
        <h2>{isPedido ? 'Pedido' : 'Orçamento'} nº {order.numero || '—'}</h2>
        <p className="muted">{order.storeName} · Vendedor: {order.vendorName} · {new Date(order.createdAt).toLocaleString('pt-BR')}</p>
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
        {orderTotalWeight(order) > 0 && <p className="muted"><Weight size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Peso total: {orderTotalWeight(order).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg</p>}
        <div className="order-total">Total: {currency(order.total)}</div>
        {order.cliente.obs && <p><strong>Obs:</strong> {order.cliente.obs}</p>}
      </div>
      <div className="form-stack pad no-print">
        {!isPedido && isVendorFlow && onEdit && (
          <button className="btn-secondary" onClick={() => onEdit(order)}>✎ Editar orçamento</button>
        )}
        {!isPedido && (
          <button className="btn-secondary" onClick={() => { const missing = getMissingFields(order); if (missing.length) { window.alert(`Preencha antes de gerar o pedido: ${missing.join(', ')}.`); return; } convertToPedido(order.id); }}><CheckCircle2 size={16} /> Converter em pedido agora</button>
        )}
        <button className="btn-secondary" disabled={!pdfLibReady} onClick={() => generatePDF(order)}>
          <Printer size={16} /> {pdfLibReady ? 'Baixar PDF' : 'Preparando gerador de PDF…'}
        </button>
        <a className="btn-whatsapp" href={waLink(order)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Enviar por WhatsApp</a>
        <button className="btn-primary" onClick={() => setScreen(backScreen)}>{backScreen === 'catalog' ? 'Novo orçamento' : 'Voltar'}</button>
      </div>
    </div>
  );
}

function QuotesScreen({ orders, convertToPedido, setScreen, onOpenOrder }) {
  const sorted = [...orders].filter(o => o.status === 'orcamento').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">Meus orçamentos</div>
        <div style={{ width: 34 }} />
      </header>
      <div className="admin-list pad">
        {sorted.map(o => (
          <div key={o.id} className="order-row clickable" onClick={() => onOpenOrder(o)}>
            <div>
              <div><strong>{o.cliente.nome}</strong> <span className="muted">nº {o.numero || '—'}</span></div>
              <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')} · {currency(o.total)}</div>
              <span className="status-badge status-orcamento">Orçamento</span>
            </div>
            <button className="btn-secondary small" onClick={(e) => { e.stopPropagation(); const missing = getMissingFields(o); if (missing.length) { window.alert(`Preencha antes de gerar o pedido: ${missing.join(', ')}.`); return; } convertToPedido(o.id); }}><CheckCircle2 size={14} /> Converter</button>
          </div>
        ))}
        {sorted.length === 0 && <p className="hint">Você não tem orçamentos pendentes agora.</p>}
      </div>
    </div>
  );
}

function MyOrdersScreen({ orders, setScreen, onOpenOrder }) {
  const sorted = [...orders].filter(o => o.status === 'pedido').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setScreen('catalog')} title="Início"><Home size={18} /></button>
        <div className="topbar-title">Meus pedidos</div>
        <div style={{ width: 34 }} />
      </header>
      <div className="admin-list pad">
        {sorted.map(o => (
          <div key={o.id} className="order-row clickable" onClick={() => onOpenOrder(o)}>
            <div>
              <div><strong>{o.cliente.nome}</strong> <span className="muted">nº {o.numero || '—'}</span></div>
              <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')} · {currency(o.total)}</div>
              <span className="status-badge status-pedido">Pedido</span>
            </div>
            <span className="muted">Comissão: {currency(o.commissionVendorValue)}</span>
          </div>
        ))}
        {sorted.length === 0 && <p className="hint">Você ainda não tem pedidos confirmados.</p>}
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

function MyReportScreen({ orders, setScreen, pdfLibReady, onOpenOrder, branding }) {
  const [period, setPeriod] = useState('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const pedidos = orders.filter(o => o.status === 'pedido' && isWithinPeriod(o.createdAt, period, customFrom, customTo))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalPedidos = pedidos.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalComissao = pedidos.reduce((s, o) => s + (Number(o.commissionVendorValue) || 0), 0);

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = addLetterhead(doc, branding);
    doc.setFontSize(15);
    doc.text('Meu relatório de vendas', 14, y); y += 8;
    doc.setFontSize(9);
    doc.text(`Período: ${periodLabel(period, customFrom, customTo)} · Pedidos: ${pedidos.length} (${currency(totalPedidos)})`, 14, y); y += 10;
    const cols = [
      { label: 'Data', width: 30 },
      { label: 'Cliente', width: 70, maxChars: 36 },
      { label: 'Total', width: 40, align: 'right' },
      { label: 'Comissão', width: 40, align: 'right' },
    ];
    const rows = pedidos.map(o => [
      new Date(o.createdAt).toLocaleDateString('pt-BR'), o.cliente.nome, currency(o.total), currency(o.commissionVendorValue),
    ]);
    y = drawPdfTable(doc, 14, y, cols, rows);
    y += 4; doc.line(14, y, 194, y); y += 8;
    doc.setFontSize(11);
    doc.text(`Total em vendas: ${currency(totalPedidos)}`, 14, y); y += 6;
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

        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Pedidos</div><div className="stat-value">{pedidos.length} · {currency(totalPedidos)}</div></div>
          <div className="stat-card"><div className="stat-label">Minha comissão</div><div className="stat-value">{currency(totalComissao)}</div></div>
        </div>

        <div className="admin-list">
          {pedidos.map(o => (
            <div key={o.id} className="order-row clickable" onClick={() => onOpenOrder(o)}>
              <div>
                <div><strong>{o.cliente.nome}</strong> <span className="muted">nº {o.numero || '—'}</span></div>
                <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <div className="order-row-values">
                <span>{currency(o.total)}</span>
                <span className="muted">Comissão: {currency(o.commissionVendorValue)}</span>
              </div>
            </div>
          ))}
          {pedidos.length === 0 && <p className="hint">Nenhum pedido nesse período.</p>}
        </div>
        {pedidos.length > 0 && (
          <div className="stat-card total-footer">
            <strong>Total do período:</strong> {currency(totalPedidos)} em vendas · {currency(totalComissao)} de comissão
          </div>
        )}
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="meu-relatorio-vendas.pdf" />
      </div>
    </div>
  );
}

function RepresentanteScreen({ currentRepresentante, stores, vendors, orders, logout, refreshAll, refreshing, pdfLibReady, onOpenOrder, branding }) {
  const [period, setPeriod] = useState('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [expandedStoreId, setExpandedStoreId] = useState(null);

  const myStores = stores.filter(s => s.representanteId === currentRepresentante.id);
  const myStoreIds = myStores.map(s => s.id);
  const filtered = orders.filter(o => o.status === 'pedido' && myStoreIds.includes(o.storeId) && isWithinPeriod(o.createdAt, period, customFrom, customTo));
  const detailedFiltered = filtered.filter(o => !storeFilter || o.storeId === storeFilter).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const totalComissaoGeral = filtered.reduce((s, o) => s + (Number(o.commissionRepresentanteValue) || 0), 0);

  const porLoja = myStores.map(s => {
    const pedidos = filtered.filter(o => o.storeId === s.id);
    const pedValue = pedidos.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const comissao = pedidos.reduce((sum, o) => sum + (Number(o.commissionRepresentanteValue) || 0), 0);
    return { id: s.id, name: s.name, pedCount: pedidos.length, pedValue, comissao };
  });
  const totalPedCount = porLoja.reduce((s, l) => s + l.pedCount, 0);
  const totalPedValue = porLoja.reduce((s, l) => s + l.pedValue, 0);

  const detFaturamento = detailedFiltered.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const detComissaoLoja = detailedFiltered.reduce((s, o) => s + (Number(o.commissionStoreValue) || 0), 0);
  const detComissaoRep = detailedFiltered.reduce((s, o) => s + (Number(o.commissionRepresentanteValue) || 0), 0);

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    let y = addLetterhead(doc, branding);
    doc.setFontSize(15);
    doc.text('Relatório do representante', 14, y); y += 8;
    doc.setFontSize(9);
    const storeLabel = storeFilter ? (myStores.find(s => s.id === storeFilter)?.name || '') : 'Todas as lojas';
    doc.text(`Representante: ${currentRepresentante.name} · Loja: ${storeLabel} · Período: ${periodLabel(period, customFrom, customTo)}`, 14, y); y += 10;
    const cols = [
      { label: 'Data', width: 26 },
      { label: 'Loja', width: 50, maxChars: 30 },
      { label: 'Cliente', width: 50, maxChars: 30 },
      { label: 'Total', width: 36, align: 'right' },
      { label: 'C. loja', width: 36, align: 'right' },
      { label: 'C. repr.', width: 36, align: 'right' },
    ];
    const rows = detailedFiltered.map(o => [
      new Date(o.createdAt).toLocaleDateString('pt-BR'), o.storeName, o.cliente.nome,
      currency(o.total), currency(o.commissionStoreValue), currency(o.commissionRepresentanteValue),
    ]);
    y = drawPdfTable(doc, 14, y, cols, rows);
    y += 4; doc.line(14, y, 14 + cols.reduce((s, c) => s + c.width, 0), y); y += 8;
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
        <label>Loja
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
            <option value="">Todas as lojas que atendo</option>
            {myStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Lojas atendidas</div><div className="stat-value">{myStores.length}</div></div>
          <div className="stat-card"><div className="stat-label">Pedidos convertidos</div><div className="stat-value">{filtered.length}</div></div>
          <div className="stat-card"><div className="stat-label">Minha comissão total</div><div className="stat-value">{currency(totalComissaoGeral)}</div></div>
        </div>

        <h3 className="report-heading">Por loja</h3>
        <div className="report-cards">
          {porLoja.map(l => (
            <div key={l.id} className="report-card">
              <div className="report-card-title">{l.name}</div>
              <div className="report-card-row"><span className="label">Pedidos</span><span>{l.pedCount} · {currency(l.pedValue)}</span></div>
              <div className="report-card-row"><span className="label">Comissão</span><span>{currency(l.comissao)}</span></div>
              <button className="btn-secondary small" style={{ marginTop: 8 }} onClick={() => setExpandedStoreId(expandedStoreId === l.id ? null : l.id)}><TrendingUp size={13} /> Ranking</button>
            </div>
          ))}
          {porLoja.length > 0 && (
            <div className="report-card footer">
              <div className="report-card-row"><span className="label">Total pedidos</span><span>{totalPedCount} · {currency(totalPedValue)}</span></div>
              <div className="report-card-row"><span className="label">Comissão total</span><span>{currency(totalComissaoGeral)}</span></div>
            </div>
          )}
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

        <h3 className="report-heading">Pedidos {storeFilter ? `— ${myStores.find(s => s.id === storeFilter)?.name}` : '(todas as lojas)'}</h3>
        <div className="admin-list">
          {detailedFiltered.map(o => (
            <div key={o.id} className="order-row clickable" onClick={() => onOpenOrder(o)}>
              <div>
                <div><strong>{o.cliente.nome}</strong> — {o.storeName} <span className="muted">nº {o.numero || '—'}</span></div>
                <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <div className="order-row-values">
                <span>{currency(o.total)}</span>
                <span className="muted">Loja: {currency(o.commissionStoreValue)}</span>
                <span className="muted">Minha: {currency(o.commissionRepresentanteValue)}</span>
              </div>
            </div>
          ))}
          {detailedFiltered.length === 0 && <p className="hint">Nenhum pedido para esse filtro.</p>}
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

function GerenteScreen({ currentGerente, stores, vendors, orders, logout, refreshAll, refreshing, pdfLibReady, onOpenOrder, branding }) {
  const [period, setPeriod] = useState('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const myStore = stores.find(s => s.id === currentGerente.storeId);
  const pedidos = orders.filter(o => o.status === 'pedido' && o.storeId === currentGerente.storeId && isWithinPeriod(o.createdAt, period, customFrom, customTo));
  const faturamentoTotal = pedidos.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const comissaoLojaTotal = pedidos.reduce((s, o) => s + (Number(o.commissionStoreValue) || 0), 0);

  const storeVendors = vendors.filter(v => v.storeId === currentGerente.storeId);
  const porVendedor = storeVendors.map(v => {
    const ped = pedidos.filter(o => o.vendorId === v.id);
    const pedValue = ped.reduce((s, o) => s + (Number(o.total) || 0), 0);
    return { id: v.id, name: v.name, pedCount: ped.length, pedValue };
  }).sort((a, b) => b.pedValue - a.pedValue);
  const totPedCount = porVendedor.reduce((s, v) => s + v.pedCount, 0);
  const totPedValue = porVendedor.reduce((s, v) => s + v.pedValue, 0);

  const sorted = [...pedidos].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const buildDoc = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    let y = addLetterhead(doc, branding);
    doc.setFontSize(15);
    doc.text('Relatório da loja', 14, y); y += 8;
    doc.setFontSize(9);
    doc.text(`Loja: ${myStore?.name || ''} · Gerente: ${currentGerente.name} · Período: ${periodLabel(period, customFrom, customTo)}`, 14, y); y += 10;
    doc.setFontSize(12);
    doc.text('Por vendedor', 14, y); y += 7;
    const cols = [
      { label: 'Vendedor', width: 60, maxChars: 34 },
      { label: 'Pedidos', width: 50, align: 'right' },
    ];
    const rows = porVendedor.map(v => [v.name, `${v.pedCount} (${currency(v.pedValue)})`]);
    y = drawPdfTable(doc, 14, y, cols, rows);
    y += 4; doc.line(14, y, 14 + cols.reduce((s, c) => s + c.width, 0), y); y += 8;
    doc.setFontSize(11);
    doc.text(`Faturamento total: ${currency(faturamentoTotal)}`, 14, y); y += 6;
    doc.text(`Comissão da loja: ${currency(comissaoLojaTotal)}`, 14, y);
    return doc;
  };

  return (
    <div className="screen">
      <header className="topbar">
        <div><div className="topbar-title">{myStore?.name}</div><div className="topbar-sub">Gerente: {currentGerente.name}</div></div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={refreshAll} title="Atualizar dados" disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'spin' : ''} /></button>
          <button className="icon-btn" onClick={logout} title="Sair"><LogOut size={18} /></button>
        </div>
      </header>
      <div className="form-stack pad">
        <PeriodFilter {...{ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }} />

        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Faturamento</div><div className="stat-value">{currency(faturamentoTotal)}</div></div>
          <div className="stat-card"><div className="stat-label">Comissão da loja</div><div className="stat-value">{currency(comissaoLojaTotal)}</div></div>
        </div>

        <h3 className="report-heading">Por vendedor</h3>
        <div className="report-cards">
          {porVendedor.map(v => (
            <div key={v.id} className="report-card">
              <div className="report-card-title">{v.name}</div>
              <div className="report-card-row"><span className="label">Pedidos</span><span>{v.pedCount} · {currency(v.pedValue)}</span></div>
            </div>
          ))}
          {porVendedor.length > 0 && (
            <div className="report-card footer">
              <div className="report-card-row"><span className="label">Total pedidos</span><span>{totPedCount} · {currency(totPedValue)}</span></div>
            </div>
          )}
          {porVendedor.length === 0 && <p className="hint">Nenhum vendedor cadastrado para esta loja ainda.</p>}
        </div>

        <h3 className="report-heading">Pedidos</h3>
        <div className="admin-list">
          {sorted.map(o => (
            <div key={o.id} className="order-row clickable" onClick={() => onOpenOrder(o)}>
              <div>
                <div><strong>{o.cliente.nome}</strong> — {o.vendorName} <span className="muted">nº {o.numero || '—'}</span></div>
                <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <div className="order-row-values"><span>{currency(o.total)}</span></div>
            </div>
          ))}
          {sorted.length === 0 && <p className="hint">Nenhum pedido nesse período.</p>}
        </div>
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="relatorio-loja.pdf" />
      </div>
    </div>
  );
}

function AdminScreen({ stores, vendors, representantes, gerentes, products, orders, updateStores, updateVendors, updateRepresentantes, updateGerentes, saveProduct, deleteProductById, adminTab, setAdminTab, adminPin, updateAdminPin, branding, updateBranding, setScreen, pdfLibReady, convertToPedido, deleteOrder, refreshAll, refreshing, onOpenOrder }) {
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
        <button className={adminTab === 'gerentes' ? 'tab active' : 'tab'} onClick={() => setAdminTab('gerentes')}><UserCog size={14} /> Gerentes</button>
        <button className={adminTab === 'pedidos' ? 'tab active' : 'tab'} onClick={() => setAdminTab('pedidos')}><Receipt size={14} /> Orçamentos/Pedidos</button>
        <button className={adminTab === 'relatorios' ? 'tab active' : 'tab'} onClick={() => setAdminTab('relatorios')}><BarChart3 size={14} /> Relatórios</button>
        <button className={adminTab === 'config' ? 'tab active' : 'tab'} onClick={() => setAdminTab('config')}><Settings size={14} /> Config</button>
      </div>
      <div className="admin-body">
        {adminTab === 'produtos' && <ProductsAdmin products={products} saveProduct={saveProduct} deleteProductById={deleteProductById} />}
        {adminTab === 'lojas' && <StoresAdmin stores={stores} updateStores={updateStores} vendors={vendors} representantes={representantes} />}
        {adminTab === 'vendedores' && <VendorsAdmin vendors={vendors} stores={stores} updateVendors={updateVendors} />}
        {adminTab === 'representantes' && <RepresentantesAdmin representantes={representantes} stores={stores} updateRepresentantes={updateRepresentantes} />}
        {adminTab === 'gerentes' && <GerentesAdmin gerentes={gerentes} stores={stores} updateGerentes={updateGerentes} />}
        {adminTab === 'pedidos' && <OrdersAdmin orders={orders} stores={stores} vendors={vendors} pdfLibReady={pdfLibReady} convertToPedido={convertToPedido} deleteOrder={deleteOrder} onOpenOrder={onOpenOrder} branding={branding} />}
        {adminTab === 'relatorios' && <RelatoriosAdmin orders={orders} stores={stores} vendors={vendors} representantes={representantes} pdfLibReady={pdfLibReady} branding={branding} />}
        {adminTab === 'config' && <ConfigAdmin adminPin={adminPin} updateAdminPin={updateAdminPin} branding={branding} updateBranding={updateBranding} />}
      </div>
    </div>
  );
}

function ProductsAdmin({ products, saveProduct, deleteProductById }) {
  const empty = { id: null, name: '', category: '', price: '', photo: '', active: true, peso: '', tamanho: '', qtdEmbalagem: '', qtdCaixa: '', caixaNaoSeAplica: false };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
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
  const save = async () => {
    if (!form.name.trim() || !form.price) return;
    const payload = { ...form, price: Number(form.price), qtdCaixa: form.caixaNaoSeAplica ? '' : form.qtdCaixa, id: editingId || uid() };
    setSaving(true);
    await saveProduct(payload);
    setSaving(false);
    setForm(empty); setEditingId(null);
  };
  const edit = (p) => { setForm({ ...empty, ...p, price: String(p.price) }); setEditingId(p.id); };
  const remove = (id) => deleteProductById(id);

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
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : (editingId ? 'Salvar alterações' : 'Adicionar produto')}</button>
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

function GerentesAdmin({ gerentes, stores, updateGerentes }) {
  const empty = { id: null, name: '', storeId: '', pin: '' };
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (!form.name.trim() || !form.storeId || !form.pin) return;
    if (editingId) updateGerentes(current => current.map(g => g.id === editingId ? { ...form, id: editingId } : g));
    else updateGerentes(current => [...current, { ...form, id: uid() }]);
    setForm(empty); setEditingId(null);
  };
  const edit = (g) => { setForm({ ...g }); setEditingId(g.id); };
  const remove = (id) => updateGerentes(current => current.filter(g => g.id !== id));
  return (
    <div>
      <div className="admin-form">
        <p className="hint">O gerente acompanha o desempenho de uma loja específica: faturamento, orçamentos/pedidos e o ranking de vendedores dela.</p>
        <label>Nome do gerente
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Ana Paula" />
        </label>
        <label>Loja
          <select value={form.storeId} onChange={e => setForm({ ...form, storeId: e.target.value })}>
            <option value="">Selecione a loja</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>PIN de acesso
          <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} placeholder="Ex: 1234" maxLength={6} />
        </label>
        <div className="admin-form-actions">
          <button className="btn-primary" onClick={save}>{editingId ? 'Salvar alterações' : 'Adicionar gerente'}</button>
          {editingId && <button className="btn-secondary" onClick={() => { setForm(empty); setEditingId(null); }}>Cancelar</button>}
        </div>
      </div>
      <div className="admin-list">
        {gerentes.map(g => (
          <div key={g.id} className="admin-list-item">
            <div className="admin-list-info"><div>{g.name}</div><div className="muted">{stores.find(s => s.id === g.storeId)?.name || '—'} · PIN {g.pin}</div></div>
            <button className="icon-btn" onClick={() => edit(g)}>✎</button>
            <button className="icon-btn" onClick={() => remove(g.id)}><Trash2 size={16} /></button>
          </div>
        ))}
        {gerentes.length === 0 && <p className="hint">Nenhum gerente cadastrado ainda.</p>}
      </div>
    </div>
  );
}

function OrdersAdmin({ orders, stores, vendors, pdfLibReady, convertToPedido, deleteOrder, onOpenOrder, branding }) {
  const [filterStore, setFilterStore] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [period, setPeriod] = useState('todos');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const vendorOptions = filterStore ? vendors.filter(v => v.storeId === filterStore) : vendors;

  const filtered = orders.filter(o => {
    if (filterStore && o.storeId !== filterStore) return false;
    if (filterVendor && o.vendorId !== filterVendor) return false;
    if (filterStatus && o.status !== filterStatus) return false;
    if (!isWithinPeriod(o.createdAt, period, customFrom, customTo)) return false;
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
    const doc = new jsPDF({ orientation: 'landscape' });
    let y = addLetterhead(doc, branding);
    doc.setFontSize(15);
    doc.text('Relatório de pedidos e comissões', 14, y); y += 8;
    doc.setFontSize(9);
    const storeName = filterStore ? (stores.find(s => s.id === filterStore)?.name || '') : 'Todas as lojas';
    const vendorName = filterVendor ? (vendors.find(v => v.id === filterVendor)?.name || '') : 'Todos os vendedores';
    doc.text(`Loja: ${storeName}`, 14, y); y += 5;
    doc.text(`Vendedor: ${vendorName}`, 14, y); y += 5;
    doc.text(`Período: ${periodLabel(period, customFrom, customTo)}`, 14, y); y += 10;
    const cols = [
      { label: 'Data', width: 24 },
      { label: 'Cliente', width: 44, maxChars: 26 },
      { label: 'Vendedor', width: 40, maxChars: 24 },
      { label: 'Status', width: 26 },
      { label: 'Total', width: 34, align: 'right' },
      { label: 'C. loja', width: 34, align: 'right' },
      { label: 'C. vend.', width: 34, align: 'right' },
    ];
    const rows = filtered.map(o => [
      new Date(o.createdAt).toLocaleDateString('pt-BR'), o.cliente.nome, o.vendorName, o.status === 'pedido' ? 'Pedido' : 'Orçamento',
      currency(o.total), currency(o.commissionStoreValue), currency(o.commissionVendorValue),
    ]);
    y = drawPdfTable(doc, 14, y, cols, rows);
    y += 4; doc.line(14, y, 14 + cols.reduce((s, c) => s + c.width, 0), y); y += 8;
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
        <PeriodFilter {...{ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }} />
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
          <div key={o.id} className="order-row clickable" onClick={() => onOpenOrder(o)}>
            <div>
              <div><strong>{o.cliente.nome}</strong> — {o.vendorName} ({o.storeName}) <span className="muted">nº {o.numero || '—'}</span></div>
              <div className="muted">{new Date(o.createdAt).toLocaleString('pt-BR')}</div>
              <span className={o.status === 'pedido' ? 'status-badge status-pedido' : 'status-badge status-orcamento'}>{o.status === 'pedido' ? 'Pedido' : 'Orçamento'}</span>
            </div>
            <div className="order-row-values">
              <span>{currency(o.total)}</span>
              <span className="muted">Loja: {currency(o.commissionStoreValue)}</span>
              <span className="muted">Vend.: {currency(o.commissionVendorValue)}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {o.status === 'orcamento' && (
                  <button className="btn-secondary small" onClick={(e) => { e.stopPropagation(); const missing = getMissingFields(o); if (missing.length) { window.alert(`Preencha antes de gerar o pedido: ${missing.join(', ')}.`); return; } convertToPedido(o.id); }}><CheckCircle2 size={14} /> Converter</button>
                )}
                <button className="btn-secondary small" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Apagar este ${o.status === 'pedido' ? 'pedido' : 'orçamento'} de ${o.cliente.nome}? Essa ação não pode ser desfeita.`)) deleteOrder(o.id); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="hint">Nenhum registro encontrado para esse filtro.</p>}
      </div>
    </div>
  );
}

function RelatoriosAdmin({ orders, stores, vendors, representantes, pdfLibReady, branding }) {
  const [filterStore, setFilterStore] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterRepresentante, setFilterRepresentante] = useState('');
  const [period, setPeriod] = useState('todos');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedStoreId, setExpandedStoreId] = useState(null);

  const vendorOptions = filterStore ? vendors.filter(v => v.storeId === filterStore) : vendors;

  const filteredOrders = orders.filter(o => {
    if (filterStore && o.storeId !== filterStore) return false;
    if (filterVendor && o.vendorId !== filterVendor) return false;
    if (!isWithinPeriod(o.createdAt, period, customFrom, customTo)) return false;
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
    const doc = new jsPDF({ orientation: 'landscape' });
    let y = addLetterhead(doc, branding);
    doc.setFontSize(15);
    doc.text('Relatório de desempenho', 14, y); y += 8;
    doc.setFontSize(9);
    const storeName = filterStore ? (stores.find(s => s.id === filterStore)?.name || '') : 'Todas as lojas';
    const vendorName = filterVendor ? (vendors.find(v => v.id === filterVendor)?.name || '') : 'Todos os vendedores';
    doc.text(`Loja: ${storeName} · Vendedor: ${vendorName}`, 14, y); y += 5;
    doc.text(`Período: ${periodLabel(period, customFrom, customTo)}`, 14, y); y += 10;

    doc.setFontSize(12);
    doc.text('Por vendedor', 14, y); y += 7;
    const colsVendedor = [
      { label: 'Vendedor', width: 44, maxChars: 26 },
      { label: 'Loja', width: 40, maxChars: 24 },
      { label: 'Orçam.', width: 24, align: 'right' },
      { label: 'Pedidos', width: 24, align: 'right' },
      { label: 'Conv.', width: 22, align: 'right' },
      { label: 'Comissão', width: 34, align: 'right' },
    ];
    const rowsVendedor = porVendedor.map(v => [v.name, v.storeName, v.orcCount, v.pedCount, `${v.taxaConversao.toFixed(0)}%`, currency(v.comissao)]);
    y = drawPdfTable(doc, 14, y, colsVendedor, rowsVendedor);
    y += 4; doc.line(14, y, 14 + colsVendedor.reduce((s, c) => s + c.width, 0), y); y += 7;
    doc.setFontSize(9);
    doc.text(`Total: ${totVendOrc} orçam. (${currency(totVendOrcValue)}) · ${totVendPed} pedidos (${currency(totVendPedValue)}) · Comissão ${currency(totVendComissao)}`, 14, y);

    y += 14;
    doc.setFontSize(12);
    doc.text('Por loja', 14, y); y += 7;
    const colsLoja = [
      { label: 'Loja', width: 44, maxChars: 26 },
      { label: 'Orçam.', width: 26, align: 'right' },
      { label: 'Pedidos', width: 26, align: 'right' },
      { label: 'C. loja', width: 30, align: 'right' },
      { label: 'Representante', width: 40, maxChars: 24 },
      { label: 'C. repr.', width: 30, align: 'right' },
    ];
    const rowsLoja = porLoja.map(s => [s.name, s.orcCount, s.pedCount, currency(s.comissaoLoja), s.repName || '—', currency(s.comissaoRepresentante)]);
    y = drawPdfTable(doc, 14, y, colsLoja, rowsLoja);
    y += 4; doc.line(14, y, 14 + colsLoja.reduce((s, c) => s + c.width, 0), y); y += 7;
    doc.setFontSize(9);
    doc.text(`Total: ${totLojaOrc} orçam. (${currency(totLojaOrcValue)}) · ${totLojaPed} pedidos (${currency(totLojaPedValue)}) · C.loja ${currency(totLojaComissao)} · C.repr. ${currency(totLojaComissaoRep)}`, 14, y);

    y += 14;
    doc.setFontSize(12);
    doc.text('Por representante', 14, y); y += 7;
    const colsRep = [
      { label: 'Representante', width: 50, maxChars: 30 },
      { label: 'Loja', width: 60, maxChars: 36 },
      { label: 'Pedidos', width: 30, align: 'right' },
      { label: 'Comissão', width: 34, align: 'right' },
    ];
    const rowsRep = porRepresentante.map(r => [r.name, r.storeName, r.pedCount, currency(r.comissao)]);
    y = drawPdfTable(doc, 14, y, colsRep, rowsRep);
    y += 4; doc.line(14, y, 14 + colsRep.reduce((s, c) => s + c.width, 0), y); y += 7;
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
        <PeriodFilter {...{ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }} />
        <ReportPdfButtons pdfLibReady={pdfLibReady} buildDoc={buildDoc} filename="relatorio-desempenho.pdf" />
      </div>

      <h3 className="report-heading">Por vendedor</h3>
      <div className="report-cards">
        {porVendedor.map(v => (
          <div key={v.id} className="report-card">
            <div className="report-card-title">{v.name} <span className="muted">— {v.storeName}</span></div>
            <div className="report-card-row"><span className="label">Orçamentos</span><span>{v.orcCount} · {currency(v.orcValue)}</span></div>
            <div className="report-card-row"><span className="label">Pedidos</span><span>{v.pedCount} · {currency(v.pedValue)}</span></div>
            <div className="report-card-row"><span className="label">Tx. conversão</span><span>{v.taxaConversao.toFixed(0)}%</span></div>
            <div className="report-card-row"><span className="label">Comissão</span><span>{currency(v.comissao)}</span></div>
          </div>
        ))}
        {porVendedor.length > 0 && (
          <div className="report-card footer">
            <div className="report-card-row"><span className="label">Total orçamentos</span><span>{totVendOrc} · {currency(totVendOrcValue)}</span></div>
            <div className="report-card-row"><span className="label">Total pedidos</span><span>{totVendPed} · {currency(totVendPedValue)}</span></div>
            <div className="report-card-row"><span className="label">Comissão total</span><span>{currency(totVendComissao)}</span></div>
          </div>
        )}
        {porVendedor.length === 0 && <p className="hint">Nenhum vendedor encontrado para esse filtro.</p>}
      </div>

      <h3 className="report-heading">Por loja</h3>
      <div className="report-cards">
        {porLoja.map(s => (
          <div key={s.id} className="report-card">
            <div className="report-card-title">{s.name}</div>
            <div className="report-card-row"><span className="label">Orçamentos</span><span>{s.orcCount} · {currency(s.orcValue)}</span></div>
            <div className="report-card-row"><span className="label">Pedidos</span><span>{s.pedCount} · {currency(s.pedValue)}</span></div>
            <div className="report-card-row"><span className="label">Comissão loja</span><span>{currency(s.comissaoLoja)}</span></div>
            <div className="report-card-row"><span className="label">Representante</span><span>{s.repName || '—'}</span></div>
            <div className="report-card-row"><span className="label">Comissão repr.</span><span>{currency(s.comissaoRepresentante)}</span></div>
            <button className="btn-secondary small" style={{ marginTop: 8 }} onClick={() => setExpandedStoreId(expandedStoreId === s.id ? null : s.id)}><TrendingUp size={13} /> Ranking</button>
          </div>
        ))}
        {porLoja.length > 0 && (
          <div className="report-card footer">
            <div className="report-card-row"><span className="label">Total orçamentos</span><span>{totLojaOrc} · {currency(totLojaOrcValue)}</span></div>
            <div className="report-card-row"><span className="label">Total pedidos</span><span>{totLojaPed} · {currency(totLojaPedValue)}</span></div>
            <div className="report-card-row"><span className="label">Comissão lojas</span><span>{currency(totLojaComissao)}</span></div>
            <div className="report-card-row"><span className="label">Comissão repr.</span><span>{currency(totLojaComissaoRep)}</span></div>
          </div>
        )}
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
      <div className="report-cards">
        {porRepresentante.map(r => (
          <div key={r.id} className="report-card">
            <div className="report-card-title">{r.name} <span className="muted">— {r.storeName}</span></div>
            <div className="report-card-row"><span className="label">Pedidos</span><span>{r.pedCount} · {currency(r.pedValue)}</span></div>
            <div className="report-card-row"><span className="label">Comissão</span><span>{currency(r.comissao)}</span></div>
          </div>
        ))}
        {porRepresentante.length > 0 && (
          <div className="report-card footer">
            <div className="report-card-row"><span className="label">Total pedidos</span><span>{totRepPed} · {currency(totRepPedValue)}</span></div>
            <div className="report-card-row"><span className="label">Comissão total</span><span>{currency(totRepComissao)}</span></div>
          </div>
        )}
        {porRepresentante.length === 0 && <p className="hint">Nenhum representante encontrado para esse filtro.</p>}
      </div>
    </div>
  );
}

function ConfigAdmin({ adminPin, updateAdminPin, branding, updateBranding }) {
  const [pin, setPin] = useState(adminPin);
  const [form, setForm] = useState(branding);
  const [logoError, setLogoError] = useState('');
  const fileInputRef = useRef(null);

  const onLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError('');
    try {
      const { dataUrl, width, height } = await resizeLogo(file);
      setForm(f => ({ ...f, logo: dataUrl, logoW: width, logoH: height }));
    } catch (err) {
      console.error(err);
      setLogoError('Não foi possível carregar essa imagem. Tente outro arquivo (JPG ou PNG).');
    }
    e.target.value = '';
  };

  return (
    <div>
      <div className="admin-form">
        <label>PIN de administrador
          <input value={pin} onChange={e => setPin(e.target.value)} maxLength={8} />
        </label>
        <button className="btn-primary" onClick={() => updateAdminPin(pin)}>Salvar PIN</button>
        <p className="hint">Este PIN dá acesso à área de administração (produtos, lojas, vendedores, representantes e comissões). A segurança aqui é simples, sem criptografia — guarde-o com os administradores de confiança.</p>
      </div>
      <div className="admin-form">
        <div className="form-subsection" style={{ borderTop: 'none', paddingTop: 0 }}>Identidade visual</div>
        <p className="hint">A logomarca aparece na tela de login de todo mundo e no topo de todos os relatórios e pedidos gerados em PDF (como um papel timbrado).</p>
        <label>Nome da empresa (aparece ao lado da logo nos PDFs)
          <input value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} placeholder="Ex: TSX Prime Revestimentos" />
        </label>
        <button type="button" className="file-label" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
          <ImagePlus size={16} /> {form.logo ? 'Trocar logomarca' : 'Adicionar logomarca'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onLogo} style={{ display: 'none' }} />
        {logoError && <div className="error">{logoError}</div>}
        {form.logo && <img className="preview-thumb" src={form.logo} alt="" style={{ background: '#f4f2ee', objectFit: 'contain' }} />}
        <button className="btn-primary" onClick={() => updateBranding(form)}>Salvar identidade visual</button>
      </div>
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
.login-logo { max-width: 160px; max-height: 64px; object-fit: contain; margin-bottom: 16px; }
.tile-mark span { background: var(--clay); }
.tile-mark span:nth-child(2), .tile-mark span:nth-child(3) { background: var(--ink-soft); }
.login-header h1 { font-size: 24px; font-weight: 600; line-height: 1.2; }
.login-header p { margin: 6px 0 0; color: var(--ink-soft); font-size: 14px; }
.tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--line); }
.tabs.wrap { flex-wrap: wrap; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.tabs.login-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; border-bottom: none; margin-bottom: 24px; }
.tabs.login-tabs .tab { flex-direction: column; align-items: center; gap: 5px; padding: 12px 4px; border: 1px solid var(--line); border-radius: 4px; border-bottom: 1px solid var(--line); color: var(--ink-soft); }
.tabs.login-tabs .tab span { font-size: 10px; font-weight: 500; letter-spacing: 0.01em; }
.tabs.login-tabs .tab.active { background: var(--ink); color: #fff; border-color: var(--ink); }
.tab { flex: none; background: none; border: none; padding: 10px 14px; font-size: 13px; font-weight: 500; color: var(--ink-soft); cursor: pointer; border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 6px; }
.tab.active { color: var(--ink); border-bottom-color: var(--clay); }
.form-stack { display: flex; flex-direction: column; gap: 14px; }
.form-stack.pad { padding: 16px; }
.form-stack label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink-soft); }
input, select, textarea { font-family: inherit; font-size: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 3px; background: var(--surface); color: var(--ink); }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--clay); outline-offset: 1px; }
.input-lg { padding: 16px 14px; font-size: 16px; }
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
.order-row.clickable { cursor: pointer; }
.order-row.clickable:hover { border-color: var(--ink-soft); }
.order-row-values { text-align: right; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.report-heading { font-family: 'Fraunces', serif; font-size: 15px; margin: 20px 0 10px; }
.report-table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; }
.report-cards { display: flex; flex-direction: column; gap: 8px; }
.report-card { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 12px 14px; font-size: 13px; }
.report-card.footer { background: var(--bg); }
.report-card-title { font-weight: 600; margin-bottom: 6px; }
.report-card-row { display: flex; justify-content: space-between; padding: 3px 0; gap: 10px; }
.report-card-row .label { color: var(--ink-soft); }
.report-table { width: 100%; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.report-table th { text-align: left; color: var(--ink-soft); font-weight: 500; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--bg); }
.report-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); }
.report-table tfoot td { font-weight: 600; background: var(--bg); border-top: 2px solid var(--line); border-bottom: none; }
.period-filter { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 12px; }
.ranking-box { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 14px; margin-top: 4px; }
.ranking-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.ranking-row:last-child { border-bottom: none; }
.pdf-actions { display: flex; flex-direction: column; gap: 8px; }
.edit-banner { background: #FBEFD9; border-bottom: 1px solid var(--line); padding: 10px 16px; font-size: 13px; color: var(--ink); }
.edit-banner button { background: none; border: none; text-decoration: underline; color: var(--ink); font-size: 13px; cursor: pointer; padding: 0; }
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

import React, { useState, useEffect, useCallback, useRef, createContext, useContext, Component } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight, BarChart3, Bitcoin, Check, ChevronDown, CircleDollarSign,
  Clock3, Copy, FileText, Filter, Grid2X2, Headphones, Home, Inbox, Layers, LogIn, LogOut,
  Mail, Menu, MessageSquare, MoreHorizontal, Pencil, ShieldCheck, ShieldX, Sparkles,
  Upload, UserCheck, Wallet, X,
  PieChart, Plus, Send, Settings, Activity,
} from 'lucide-react';
import { supabase } from './supabase.js';
import './styles.css';

// ─── Static reference data (illustrative marketing assets) ───────────────────
// Coin metadata used across the app. Market data (price, change) is fetched live.
const COINS = [
  { id: 'bitcoin',       symbol: 'BTC',  name: 'Bitcoin',     tone: 'orange', color: '#f7931a', description: 'The original decentralized cryptocurrency' },
  { id: 'ethereum',      symbol: 'ETH',  name: 'Ethereum',    tone: 'blue',   color: '#627eea', description: 'A blockchain supporting smart contracts' },
  { id: 'solana',        symbol: 'SOL',  name: 'Solana',      tone: 'mint',   color: '#00a878', description: 'A high-speed chain designed for fast transactions' },
  { id: 'ripple',        symbol: 'XRP',  name: 'XRP',         tone: 'blue',   color: '#23292f', description: 'Cross-border payment settlement network' },
  { id: 'binancecoin',   symbol: 'BNB',  name: 'BNB',         tone: 'orange', color: '#f3ba2f', description: 'Native token of the BNB Chain ecosystem' },
  { id: 'dogecoin',      symbol: 'DOGE', name: 'Dogecoin',    tone: 'orange', color: '#c2a633', description: 'A lighthearted, community-driven cryptocurrency' },
  { id: 'cardano',       symbol: 'ADA',  name: 'Cardano',     tone: 'blue',   color: '#0033ad', description: 'A proof-of-stake blockchain research platform' },
  { id: 'avalanche-2',   symbol: 'AVAX', name: 'Avalanche',   tone: 'orange', color: '#e84142', description: 'A fast, low-cost smart contract platform' },
  { id: 'chainlink',     symbol: 'LINK', name: 'Chainlink',   tone: 'blue',   color: '#2a5ada', description: 'Decentralized oracle network for smart contracts' },
  { id: 'polkadot',      symbol: 'DOT',  name: 'Polkadot',    tone: 'blue',   color: '#e6007a', description: 'A multi-chain framework for interoperable blockchains' },
  { id: 'litecoin',      symbol: 'LTC',  name: 'Litecoin',    tone: 'blue',   color: '#345d9d', description: 'A peer-to-peer cryptocurrency with fast confirmation' },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin',   tone: 'blue',   color: '#0098ea', description: 'The native token of The Open Network' },
];
const COIN_BY_ID = {};
COINS.forEach(c => { COIN_BY_ID[c.id] = c; });
const COIN_BY_SYMBOL = {};
COINS.forEach(c => { COIN_BY_SYMBOL[c.symbol] = c; });

// Legacy static assets kept for backwards compatibility (non-live contexts).
const assets = COINS.slice(0, 3).map(c => ({
  name: c.name, symbol: c.symbol, value: '—', amount: '', change: '—', tone: c.tone, description: c.description,
}));

const navItems = [
  { label: 'Home',        page: 'home' },
  { label: 'Investments', page: 'investments' },
  { label: 'Portfolio',   page: 'portfolio' },
  { label: 'Assets',      page: 'assets' },
];

// ─── Formatting helpers ──────────────────────────────────────────────────────
function fmtMoney(value, currency = 'USD') {
  const n = Number(value ?? 0);
  if (!isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)}`;
  }
}
function fmtQty(value, symbol = '') {
  const n = Number(value ?? 0);
  if (!isFinite(n) || n === 0) return symbol ? `0 ${symbol}` : '0';
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return symbol ? `${s} ${symbol}` : s;
}
function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtPct(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

// Map a risk level to a tone class for styling.
const riskTone = { conservative: 'mint', moderate: 'blue', aggressive: 'orange' };

// Map a holdings/investments asset symbol to the marketing tone/color.
const symbolTone = {};
COINS.forEach(c => { symbolTone[c.symbol] = c.tone; });
const symbolIcon = { BTC: Bitcoin, ETH: CircleDollarSign, SOL: CircleDollarSign };

// ─── Live crypto price hook ──────────────────────────────────────────────────
// Fetches live USD prices from the crypto-prices edge function (CoinGecko proxy).
// Polls every 20 seconds. Handles rate-limiting and stale data gracefully.
const CRYPTO_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crypto-prices`;
const POLL_INTERVAL = 20000;

function useCryptoPrices(enabled = true) {
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [stale, setStale] = useState(false);
  const [live, setLive] = useState(false);
  const timerRef = useRef(null);

  const fetchPrices = useCallback(async () => {
    try {
      const resp = await fetch(CRYPTO_API, { headers: { Accept: 'application/json' } });
      if (resp.status === 503) {
        setStale(true);
        if (loading) setLoading(false);
        return;
      }
      if (!resp.ok) throw new Error('fetch_failed');
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const map = {};
      (data.prices || []).forEach(p => {
        map[p.symbol] = p;
      });
      setPrices(prev => {
        const next = {};
        Object.keys(map).forEach(sym => {
          const old = prev[sym];
          const np = map[sym];
          if (old && old.price != null && np.price != null) {
            next[sym] = { ...np, prevPrice: old.price, direction: np.price > old.price ? 'up' : np.price < old.price ? 'down' : old.direction || '' };
          } else {
            next[sym] = { ...np, prevPrice: np.price, direction: '' };
          }
        });
        return next;
      });
      setLastUpdated(Date.now());
      setLive(true);
      setStale(false);
      setError('');
    } catch {
      setStale(true);
      setLive(false);
      if (loading) setError('Live prices are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    if (!enabled) return;
    fetchPrices();
    timerRef.current = setInterval(fetchPrices, POLL_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [enabled, fetchPrices]);

  return { prices, loading, error, lastUpdated, stale, live, reload: fetchPrices };
}

// Animated number that counts up/down to a target value.
function AnimatedPrice({ value, format }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState('');
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    if (value == null || prev == null) { setDisplay(value); prevRef.current = value; return; }
    if (value === prev) return;

    const diff = value - prev;
    const duration = 600;
    const start = performance.now();
    const from = prev;
    const to = value;

    setFlash(diff > 0 ? 'flash-up' : 'flash-down');
    const flashTimer = setTimeout(() => setFlash(''), 1000);

    let rafId;
    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + diff * eased);
      if (t < 1) { rafId = requestAnimationFrame(tick); }
      else { setDisplay(to); prevRef.current = to; }
    }
    rafId = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(rafId); clearTimeout(flashTimer); };
  }, [value]);

  if (value == null) return <span className="price-placeholder">—</span>;
  return <span className={flash}>{format(display)}</span>;
}

// Animated percentage change with color and arrow.
function AnimatedChange({ value }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value == null || prevRef.current == null) { setDisplay(value); prevRef.current = value; return; }
    if (value === prevRef.current) return;
    const diff = value - prevRef.current;
    const duration = 500;
    const start = performance.now();
    const from = prevRef.current;
    const to = value;
    let rafId;
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + diff * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else { setDisplay(to); prevRef.current = to; }
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value]);

  if (value == null) return <span className="muted">—</span>;
  const isUp = display >= 0;
  return (
    <span className={`change-badge ${isUp ? 'up' : 'down'}`}>
      {isUp ? '▲' : '▼'} {Math.abs(display).toFixed(2)}%
    </span>
  );
}

// Live status indicator dot.
function LiveDot({ live, stale }) {
  return (
    <span className={`live-dot ${stale ? 'stale' : live ? 'live' : 'idle'}`}>
      <i></i>{stale ? 'Stale' : live ? 'Live' : 'Connecting…'}
    </span>
  );
}

// Format a crypto price with appropriate decimals.
function fmtCryptoPrice(price) {
  if (price == null) return '—';
  const n = Number(price);
  if (!isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

// Coin logo badge with first-letter fallback and brand color.
function CoinLogo({ coin, size = 52 }) {
  const style = { width: size, height: size, background: coin.color, fontSize: size > 40 ? '18px' : '14px' };
  return (
    <div className="coin-logo" style={style}>
      {coin.symbol.charAt(0)}
    </div>
  );
}

// ─── Portfolio data hook ─────────────────────────────────────────────────────
// Loads the signed-in user's portfolio, holdings, investments (with plan info),
// and recent transactions in parallel. All queries are RLS-scoped to the caller.
function usePortfolioData(enabled) {
  const [portfolio, setPortfolio]   = useState(null);
  const [holdings, setHoldings]     = useState([]);
  const [investments, setInvestments] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pRes, hRes, invRes, txRes] = await Promise.all([
        supabase.from('portfolios').select('id,user_id,name,currency,cash_balance,created_at,updated_at').maybeSingle(),
        supabase.from('holdings').select('id,portfolio_id,asset_symbol,asset_name,quantity,average_cost,created_at,updated_at').order('asset_symbol', { ascending: true }),
        supabase.from('investments').select('id,portfolio_id,plan_id,amount,status,outcome_value,expected_return,maturity_date,returns_credited,started_at,completed_at,created_at,updated_at').order('created_at', { ascending: false }),
        supabase.from('transactions').select('id,portfolio_id,type,amount,status,reference,description,processed_at,created_at,updated_at').order('created_at', { ascending: false }).limit(8),
      ]);
      const errs = [pRes, hRes, invRes, txRes].filter(r => r.error);
      if (errs.length) throw errs[0].error;
      setPortfolio(pRes.data);
      setHoldings(hRes.data ?? []);
      setInvestments(invRes.data ?? []);
      setTransactions(txRes.data ?? []);
    } catch (e) {
      setPortfolio(null); setHoldings([]); setInvestments([]); setTransactions([]);
      setError('We could not load your portfolio. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { portfolio, holdings, investments, transactions, loading, error, reload: load };
}

// ─── Investment plans hook ───────────────────────────────────────────────────
function useInvestmentPlans(enabled) {
  const [plans, setPlans]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('investment_plans')
        .select('id,name,description,target_return,fixed_return_rate,duration_days,risk_level,min_amount,max_amount,payment_schedule,return_calc_method,is_active,created_at')
        .order('min_amount', { ascending: true });
      if (error) throw error;
      setPlans(data ?? []);
    } catch {
      setPlans([]);
      setError('We could not load investment plans. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { plans, loading, error, reload: load };
}

// ─── Auth context ─────────────────────────────────────────────────────────────
// `profile` is the row from the `profiles` table for the signed-in user.
// `profileLoading` is true while we are fetching it, separately from session
// restoration, so a page can show a spinner even after the session is known.
// `isAdmin` is derived from profile.role === 'admin' and also confirmed via
// the is_admin() RPC when needed.
const AuthCtx = createContext({
  session: null, loading: true,
  profile: null, profileLoading: false, refreshProfile: () => {},
  isAdmin: false,
});
function useAuth() { return useContext(AuthCtx); }

// Fetch the signed-in user's profile row. Uses maybeSingle() because a profile
// may not exist yet (e.g. trigger lag) — returning null is a valid state.
async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, bio, kyc_status, role, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Modal primitive ──────────────────────────────────────────────────────────
function Modal({ open, onClose, title, eyebrow, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={ev => ev.stopPropagation()}>
        <div className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow green">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Transaction request modal ───────────────────────────────────────────────
// Used for deposit, withdrawal, and investment requests. Calls the appropriate
// SECURITY DEFINER function via supabase.rpc(). Amounts are validated
// server-side; the frontend only provides the input.
//
// Deposit mode is BTC-only: it shows the admin-configured Bitcoin receiving
// address, a QR code, a copy button, an optional receipt upload, and an
// optional BTC transaction hash field. The receipt is uploaded to a private
// storage bucket before the deposit request is created.
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const RECEIPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

function qrCodeUrl(text, size = 180) {
  // Render a QR code as an inline SVG string (no external network call).
  // Minimal QR generator — public domain algorithm by Project Nayuki.
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

function useBtcAddress(enabled) {
  const [address, setAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('btc_receive_address')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      setAddress(data?.btc_receive_address ?? null);
    } catch {
      setAddress(null);
      setError('We could not load the deposit address. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { address, loading, error, reload: load };
}

function TxModal({ open, mode, onClose, cashBalance, currency, plans, onDone, onInvestSuccess, preselectedPlanId, onNavigate }) {
  const [amount, setAmount]       = useState('');
  const [description, setDescription] = useState('');
  const [planId, setPlanId]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [errors, setErrors]       = useState([]);
  const [success, setSuccess]     = useState('');
  // BTC deposit fields
  const [txHash, setTxHash]       = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [copied, setCopied]       = useState(false);
  const { session, profile } = useAuth();
  const { address: btcAddress, loading: addrLoading, error: addrError } = useBtcAddress(open && mode === 'deposit');
  const isDeposit = mode === 'deposit';
  const isInvest = mode === 'invest';
  const isWithdraw = mode === 'withdraw';
  const kycVerified = profile?.kyc_status === 'verified';
  const kycPending = profile?.kyc_status === 'pending';
  const kycBlocked = (isInvest || isWithdraw) && !kycVerified;

  useEffect(() => {
    if (open) {
      setAmount(''); setDescription(''); setErrors([]); setSuccess('');
      setTxHash(''); setReceiptFile(null); setCopied(false);
      setPlanId(preselectedPlanId || '');
    }
  }, [open, mode, preselectedPlanId]);

  const selectedPlan = plans.find(p => p.id === planId);
  const minAmount = selectedPlan ? Number(selectedPlan.min_amount) : 0;
  const title = isInvest ? 'Submit investment' : isWithdraw ? 'Request withdrawal' : 'Deposit Bitcoin';
  const eb = isInvest ? 'New investment' : isWithdraw ? 'Withdraw funds' : 'Add funds (BTC)';

  async function handleCopyAddress() {
    if (!btcAddress) return;
    try {
      await navigator.clipboard.writeText(btcAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrors(['Could not copy the address. Please copy it manually.']);
    }
  }

  function validateReceipt(file) {
    if (!file) return null;
    if (!RECEIPT_TYPES.includes(file.type)) {
      return 'Receipt must be a PNG, JPEG, WebP, GIF, or PDF file.';
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      return 'Receipt must be 5 MB or smaller.';
    }
    return null;
  }

  function handleReceiptChange(e) {
    const file = e.target.files?.[0] ?? null;
    const err = validateReceipt(file);
    if (err) { setErrors([err]); setReceiptFile(null); return; }
    setErrors([]); setReceiptFile(file);
  }

  async function uploadReceipt(userId) {
    if (!receiptFile) return null;
    const ext = receiptFile.name.split('.').pop() || 'bin';
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 5) || 'bin';
    const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const { error } = await supabase.storage
      .from('deposit-receipts')
      .upload(fileName, receiptFile, { contentType: receiptFile.type, upsert: false });
    if (error) throw new Error('We could not upload your receipt. Please try again.');
    return fileName;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]); setSuccess('');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErrors(['Enter an amount greater than zero.']); return; }
    if (isInvest && !planId) { setErrors(['Select an investment plan.']); return; }
    if (isInvest && amt < minAmount) { setErrors([`Amount must be at least ${fmtMoney(minAmount, currency)}.`]); return; }
    if (isInvest && selectedPlan && selectedPlan.max_amount && amt > Number(selectedPlan.max_amount)) {
      setErrors([`Amount must not exceed ${fmtMoney(Number(selectedPlan.max_amount), currency)} for this plan.`]); return;
    }
    if (isWithdraw && amt > cashBalance) { setErrors([`Insufficient balance. Available: ${fmtMoney(cashBalance, currency)}.`]); return; }
    if (isDeposit && !btcAddress) { setErrors(['No Bitcoin receiving address is configured yet. Please contact support.']); return; }
    if (isDeposit && txHash.trim() && !/^[0-9a-fA-F]+$/.test(txHash.trim())) {
      setErrors(['Transaction hash may only contain hexadecimal characters (0-9, a-f).']);
      return;
    }

    setLoading(true);
    try {
      let error;
      let investId = null;
      if (isInvest) {
        const res = await supabase.rpc('submit_investment', { p_plan_id: planId, p_amount: amt });
        error = res.error;
        investId = res.data;
      } else if (isWithdraw) {
        ({ error } = await supabase.rpc('submit_withdrawal', { p_amount: amt, p_description: description || null }));
      } else {
        // BTC deposit: upload receipt first (if provided), then create the request.
        const userId = session?.user?.id;
        let receiptPath = null;
        if (receiptFile && userId) {
          receiptPath = await uploadReceipt(userId);
        }
        ({ error } = await supabase.rpc('submit_deposit', {
          p_amount: amt,
          p_description: description || null,
          p_tx_hash: txHash.trim() || null,
          p_receipt_path: receiptPath,
        }));
      }
      if (error) throw error;
      if (isInvest && investId && onInvestSuccess) {
        onDone();
        onClose();
        onInvestSuccess({ planId, amount: amt, investId, planName: selectedPlan?.name, plan: selectedPlan });
        return;
      }
      setSuccess(isDeposit
        ? 'Deposit request submitted. We will verify your Bitcoin payment and update the status.'
        : isInvest
        ? 'Investment submitted. It will appear in your portfolio once approved and activated by an administrator.'
        : 'Request submitted. You can track its status in your portfolio.');
      setTimeout(() => { onDone(); onClose(); }, 1600);
    } catch (err) {
      const msg = err && err.message ? err.message : '';
      if (msg.includes('receipt') || msg.includes('upload')) {
        setErrors([msg]);
      } else if (msg.includes('Insufficient balance')) {
        setErrors(['Insufficient available balance for this investment. Deposit funds first, then try again.']);
      } else {
        setErrors(['We could not submit your request. Please check your details and try again.']);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} eyebrow={eb}>
      <form className="tx-form" onSubmit={handleSubmit} noValidate>
        {errors.length > 0 && (
          <div className="error-box">{errors.map((er, i) => <span key={i}>{er}</span>)}</div>
        )}
        {success && (
          <div className="success-box compact"><Check size={18} /><span>{success}</span></div>
        )}

        {kycBlocked && (
          <div className="kyc-block-box">
            <ShieldX size={20} />
            <div>
              <strong>{kycPending ? 'Verification under review' : 'Identity verification required'}</strong>
              <p>{kycPending
                ? 'Your identity verification is being reviewed. We will notify you once it is approved. Until then, you cannot ' + (isInvest ? 'invest' : 'withdraw') + '.'
                : 'You need to complete identity verification before you can ' + (isInvest ? 'invest' : 'withdraw') + '. This is a security requirement.'}</p>
              <Button onClick={() => { onClose(); onNavigate('kyc'); }}>{kycPending ? 'View verification status' : 'Verify your identity'} <ArrowUpRight size={17} /></Button>
            </div>
          </div>
        )}

        {!kycBlocked && isDeposit && (
          <>
            <div className="btc-deposit-banner">
              <Bitcoin size={20} />
              <span>Send Bitcoin (BTC) only. Sending any other asset may result in a permanent loss.</span>
            </div>

            {addrLoading ? (
              <div className="btc-address-box"><span className="muted">Loading deposit address…</span></div>
            ) : addrError ? (
              <div className="btc-address-box"><span className="muted">{addrError}</span></div>
            ) : !btcAddress ? (
              <div className="btc-address-box">
                <span className="muted">No Bitcoin receiving address is configured yet. Please contact support to deposit.</span>
              </div>
            ) : (
              <div className="btc-address-box">
                <div className="btc-qr">
                  <img src={qrCodeUrl(btcAddress, 180)} alt="QR code for Bitcoin address" width={180} height={180} />
                </div>
                <div className="btc-address-detail">
                  <span className="btc-label">Bitcoin receiving address</span>
                  <code className="btc-address-text">{btcAddress}</code>
                  <button type="button" className="btn outline copy-btn" onClick={handleCopyAddress}>
                    {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy address</>}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {!kycBlocked && isInvest && (
          <label className="full">Investment plan
            <select value={planId} onChange={ev => setPlanId(ev.target.value)}>
              <option value="">Select a plan…</option>
              {plans.filter(p => p.is_active).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — min {fmtMoney(p.min_amount, currency)} — {p.risk_level}
                </option>
              ))}
            </select>
          </label>
        )}

        {!kycBlocked && (
        <>
        <label className="full">Amount ({isDeposit ? 'USD intended' : currency})
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={ev => setAmount(ev.target.value)}
          />
        </label>

        {isDeposit && (
          <p className="muted btc-hint">Enter the USD value you intend to deposit. The actual BTC amount is verified by the administrator after you send.</p>
        )}

        {!isDeposit && !isInvest && (
          <label className="full">{isWithdraw ? 'Note (optional)' : 'Deposit details (optional)'}
            <input
              type="text"
              placeholder={isWithdraw ? 'e.g. Bank transfer to checking' : 'e.g. Wire transfer ref'}
              value={description}
              onChange={ev => setDescription(ev.target.value)}
              maxLength={200}
            />
          </label>
        )}

        {isDeposit && (
          <>
            <label className="full">Bitcoin transaction hash (optional)
              <input
                type="text"
                placeholder="e.g. a1b2c3…"
                value={txHash}
                onChange={ev => setTxHash(ev.target.value)}
                maxLength={128}
              />
            </label>
            <label className="full receipt-label">Receipt or screenshot (optional, max 5 MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                onChange={handleReceiptChange}
              />
              {receiptFile && <span className="muted receipt-chosen">Selected: {receiptFile.name} ({(receiptFile.size / 1024).toFixed(0)} KB)</span>}
            </label>
          </>
        )}

        {isInvest && selectedPlan && (
          <div className="tx-info invest-preview">
            <span>Fixed return: <strong>{fmtPct(Number(selectedPlan.fixed_return_rate ?? 0))} APY</strong></span>
            <span>Duration: <strong>{selectedPlan.duration_days} days</strong></span>
            <span>Payments: <strong>{selectedPlan.payment_schedule === 'monthly' ? 'Monthly' : 'At maturity'}</strong></span>
            {amount && parseFloat(amount) > 0 && (
              <span>Est. return: <strong className="green-text">{fmtMoney(parseFloat(amount) * (Number(selectedPlan.fixed_return_rate ?? 0) / 100) * (selectedPlan.duration_days / 365), currency)}</strong></span>
            )}
            <span>Available: <strong>{fmtMoney(cashBalance, currency)}</strong></span>
          </div>
        )}
        {!isInvest && (
          <div className="tx-info">
            <span>Available balance: <strong>{fmtMoney(cashBalance, currency)}</strong></span>
          </div>
        )}
        </>
        )}

        {!kycBlocked && (
          <Button type="submit" disabled={loading || (isDeposit && addrLoading)}>
            {loading ? 'Submitting…' : isDeposit ? "I've made the deposit" : 'Submit request'}
            {!loading && <ArrowUpRight size={17} />}
          </Button>
        )}
      </form>
    </Modal>
  );
}

// ─── Investment confirmation modal ───────────────────────────────────────────
function InvestmentConfirmation({ open, result, onClose, onNavigate, currency }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !result?.investId) { setDetails(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('investments')
          .select('id,plan_id,amount,status,expected_return,maturity_date,started_at,created_at,reference')
          .eq('id', result.investId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) setDetails(data);
      } catch {
        if (!cancelled) setDetails(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, result]);

  if (!open) return null;
  const plan = result?.plan;
  const amt = result?.amount ?? details?.amount ?? 0;
  const planName = plan?.name || details?.plan_id || 'Investment plan';
  const now = new Date();
  const rate = Number(plan?.fixed_return_rate ?? 0);
  const duration = Number(plan?.duration_days ?? 0);
  const maturityDate = details?.maturity_date
    ? new Date(details.maturity_date)
    : (duration > 0 ? new Date(now.getTime() + duration * 86400000) : null);
  const schedule = plan?.payment_schedule === 'monthly' ? 'Monthly payments' : 'Paid at maturity';
  const expectedReturn = details?.expected_return
  ? Number(details.expected_return)
  : (rate > 0 ? amt * (rate / 100) : 0);
  : (rate > 0 ? amt * (rate / 100) * (duration / 365) : 0);
  return (
    <Modal open={open} onClose={onClose} title="Investment confirmed" eyebrow="Success">
      <div className="confirm-body">
        <div className="confirm-check"><Check size={28} /></div>
        <p className="confirm-intro">
          Your investment has been recorded successfully. It will appear in your portfolio once approved and activated by an administrator.
        </p>

        {loading ? (
          <LoadingState label="Loading investment details…" />
        ) : (
          <div className="confirm-details">
            <div className="confirm-row"><span>Plan</span><strong>{planName}</strong></div>
            <div className="confirm-row"><span>Amount invested</span><strong>{fmtMoney(amt, currency)}</strong></div>
            <div className="confirm-row"><span>Date</span><strong>{fmtDate(details?.created_at || now.toISOString())}</strong></div>
            {details?.reference && <div className="confirm-row"><span>Reference</span><strong className="mono">{details.reference}</strong></div>}
            <div className="confirm-row"><span>Status</span><StatusBadge status={details?.status || 'pending'} /></div>
            {duration > 0 && <div className="confirm-row"><span>Duration</span><strong>{duration} days</strong></div>}
            {maturityDate && <div className="confirm-row"><span>Expected maturity</span><strong>{fmtDate(maturityDate.toISOString())}</strong></div>}
            <div className="confirm-row"><span>Payment schedule</span><strong>{schedule}</strong></div>
            <div className="confirm-row"><span>Fixed return rate</span><strong>{fmtPct(rate)} APY</strong></div>
            {expectedReturn > 0 && <div className="confirm-row"><span>Expected return</span><strong className="green-text">{fmtMoney(expectedReturn, currency)}</strong></div>}
          </div>
        )}

        <div className="confirm-actions">
          <Button variant="outline" onClick={() => { onClose(); onNavigate('portfolio'); }}>View in portfolio <Wallet size={16} /></Button>
          <Button variant="outline" onClick={() => { onClose(); onNavigate('transactions'); }}>Transaction history <Clock3 size={16} /></Button>
        </div>
        <button className="text-link confirm-close" onClick={onClose}>Stay on this page</button>
      </div>
    </Modal>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
function Logo({ compact = false }) {
  return (
    <div className="logo">
      <div className="logo-mark"><Sparkles size={22} /></div>
      {!compact && <div><strong>Nexora</strong><span>CAPITAL</span></div>}
    </div>
  );
}

function Button({ children, variant = 'primary', onClick, icon: Icon, type = 'button', disabled = false }) {
  return (
    <button type={type} className={`btn ${variant}`} onClick={onClick} disabled={disabled}>
      {children}{Icon && <Icon size={18} />}
    </button>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function UserMenu({ onNavigate, onSignOut }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const name = profile?.display_name || '';
  const initials = initialsFromName(name);

  function go(page) {
    setOpen(false);
    onNavigate(page);
  }

  return (
    <div className="user-menu" ref={ref}>
      <button className={`user-menu-trigger${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-label="Open account menu" aria-expanded={open}>
        <span className="user-avatar">{initials}</span>
        <span className="user-menu-name">{name || 'Account'}</span>
        <ChevronDown size={16} className={open ? 'chev-up' : ''} />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="user-dropdown">
            <div className="dropdown-header">
              <div className="user-avatar lg">{initials}</div>
              <div>
                <strong>{name || 'Welcome'}</strong>
                <span>Manage your account</span>
              </div>
            </div>
            <div className="dropdown-links">
              <button onClick={() => go('dashboard')}><Grid2X2 size={16} /> Dashboard</button>
              <button onClick={() => go('portfolio')}><Wallet size={16} /> Portfolio</button>
              <button onClick={() => go('investments')}><Layers size={16} /> Investments</button>
              <button onClick={() => go('transactions')}><Clock3 size={16} /> Transaction history</button>
              <button onClick={() => go('settings')}><Settings size={16} /> Account settings</button>
              <button onClick={() => go('kyc')}><ShieldCheck size={16} /> Identity verification</button>
              <button onClick={() => go('support')}><Headphones size={16} /> Support</button>
            </div>
            <div className="dropdown-footer">
              <button onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={16} /> Sign out</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function initialsFromName(name) {
  const base = (name || '').trim();
  if (!base) return 'NC';
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function TopNav({ active, onNavigate }) {
  const { session, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    onNavigate('home');
  }

  return (
    <header className="topbar">
      <div className="nav-inner">
        <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Open menu">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <button className="brand-button" onClick={() => onNavigate('home')}><Logo /></button>
        <nav className={open ? 'nav-links open' : 'nav-links'}>
          {navItems.map(item => (
            <button
              key={item.page}
              className={active === item.page ? 'active' : ''}
              onClick={() => { onNavigate(item.page); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
          {session && (
            <button
              className={active === 'transactions' ? 'active' : ''}
              onClick={() => { onNavigate('transactions'); setOpen(false); }}
            >Transactions</button>
          )}
          {session && (
            <button
              className={active === 'support' ? 'active' : ''}
              onClick={() => { onNavigate('support'); setOpen(false); }}
            >Support</button>
          )}
          {isAdmin && (
            <button
              className={active === 'admin' ? 'active' : ''}
              onClick={() => { onNavigate('admin'); setOpen(false); }}
            >Admin</button>
          )}
        </nav>
        <div className="nav-actions">
          {session ? (
            <>
              <button className="icon-only" aria-label="Open dashboard" onClick={() => onNavigate('dashboard')}>
                <Grid2X2 size={18} />
              </button>
              <UserMenu onNavigate={onNavigate} onSignOut={handleSignOut} />
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onNavigate('signin')}>Sign in</Button>
              <Button onClick={() => onNavigate('signup')}>Get started</Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({ onNavigate }) {
  return (
    <footer>
      <div className="footer-main">
        <Logo />
        <div className="footer-links">
          <div>
            <strong>Explore</strong>
            <button onClick={() => onNavigate('home')}>Home</button>
            <button onClick={() => onNavigate('investments')}>Investments</button>
            <button onClick={() => onNavigate('portfolio')}>Portfolio</button>
            <button onClick={() => onNavigate('transactions')}>Transactions</button>
          </div>
          <div>
            <strong>Company</strong>
            <button type="button" onClick={() => onNavigate('home')} aria-label="About Nexora Capital">About Nexora</button>
            <button type="button" onClick={() => onNavigate('assets')} aria-label="Explore market insights and digital assets">Insights</button>
            <button type="button" onClick={() => onNavigate('support')} aria-label="Contact Nexora Capital support">Contact</button>
          </div>
          <div>
            <strong>Support</strong>
            <button type="button" onClick={() => onNavigate('support')}>Help center</button>
            <button type="button" onClick={() => onNavigate('support')} aria-label="Get help with security questions">Security</button>
            <button type="button" onClick={() => onNavigate('support')} aria-label="Ask support about terms and conditions">Terms</button>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Nexora Capital</span>
        <span>Digital assets, thoughtfully.</span>
      </div>
    </footer>
  );
}

// ─── Chart & preview ──────────────────────────────────────────────────────────
function Chart({ small = false }) {
  return (
    <div className={small ? 'chart small-chart' : 'chart'}>
      <div className="chart-labels"><span>$27K</span><span>$24K</span><span>$21K</span></div>
      <svg viewBox="0 0 600 220" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#00a878" stopOpacity=".22"/>
            <stop offset="1" stopColor="#00a878" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d="M0,185 C65,174 78,150 132,160 S205,114 260,130 S322,125 360,114 S413,135 455,94 S518,86 600,24 L600,220 L0,220Z" fill="url(#fill)"/>
        <path d="M0,185 C65,174 78,150 132,160 S205,114 260,130 S322,125 360,114 S413,135 455,94 S518,86 600,24" fill="none" stroke="#00a878" strokeWidth="4" strokeLinecap="round"/>
        <circle cx="600" cy="24" r="7" fill="#b7f34a" stroke="#fff" strokeWidth="4"/>
      </svg>
      <div className="chart-days">
        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
      </div>
    </div>
  );
}

// ─── App showcase: smartphone mockup with branded green app icon ─────────────
function AppShowcase({ onNavigate }) {
  return (
    <div className="app-showcase">
      <div className="phone-mockup">
        <div className="phone-notch"></div>
        <div className="phone-screen">
          <div className="phone-status-bar">
            <span>9:41</span>
            <span className="phone-status-icons">
              <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor"><path d="M1 7h2v2H1zM4 5h2v4H4zM7 3h2v6H7zM10 1h2v8h-2z"/></svg>
              <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="2" width="11" height="6" rx="1.5"/><rect x="13" y="4" width="1.5" height="2" rx=".5" fill="currentColor"/><rect x="2.5" y="3.5" width="7" height="3" rx=".5" fill="currentColor"/></svg>
            </span>
          </div>
          <div className="phone-app-content">
            <div className="phone-app-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l6-6 4 4 8-8"/>
                <path d="M17 7h4v4"/>
              </svg>
            </div>
            <h3 className="phone-app-title">Nexora Capital</h3>
            <span className="phone-app-tag">Digital investing</span>
            <div className="phone-welcome">
              <span className="phone-welcome-eyebrow">Welcome back</span>
              <p>Track your portfolio, explore live market prices, and manage your investments — all in one place.</p>
            </div>
            <div className="phone-mock-rows">
              <div className="phone-mock-row">
                <div className="phone-mock-icon" style={{ background: '#f7931a' }}>B</div>
                <div className="phone-mock-bar"><span>Bitcoin</span><span>BTC</span></div>
                <div className="phone-mock-val">$—</div>
              </div>
              <div className="phone-mock-row">
                <div className="phone-mock-icon" style={{ background: '#627eea' }}>E</div>
                <div className="phone-mock-bar"><span>Ethereum</span><span>ETH</span></div>
                <div className="phone-mock-val">$—</div>
              </div>
              <div className="phone-mock-row">
                <div className="phone-mock-icon" style={{ background: '#00a878' }}>S</div>
                <div className="phone-mock-bar"><span>Solana</span><span>SOL</span></div>
                <div className="phone-mock-val">$—</div>
              </div>
            </div>
            <button className="phone-cta-btn" onClick={() => onNavigate('signup')}>Get Started</button>
          </div>
        </div>
        <div className="phone-glow"></div>
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function Feature({ icon: Icon, title, text }) {
  return (
    <div className="feature-card">
      <div className="feature-icon"><Icon size={22} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function AssetCard({ asset, onClick, compact = false }) {
  const Icon = asset.symbol === 'BTC' ? Bitcoin : CircleDollarSign;
  return (
    <button className={`asset-card ${compact ? 'compact' : ''}`} onClick={onClick}>
      <div className={`coin ${asset.tone}`}><Icon size={24} /></div>
      <div className="asset-info">
        <h3>{asset.name}</h3>
        <span>{asset.symbol}</span>
        {!compact && <p>{asset.description}</p>}
      </div>
      <div className="asset-value">
        <strong>{asset.value}</strong>
        <span className="positive">{asset.change}</span>
      </div>
      {!compact && <span className="details">Details <ArrowUpRight size={16} /></span>}
    </button>
  );
}

function PageHeader({ eyebrow, title, text }) {
  return (
    <div className="page-header">
      <span className="eyebrow green">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

function Metric({ label, value, green }) {
  return (
    <div className="metric card">
      <span>{label}</span>
      <strong className={green ? 'green-text' : ''}>{value}</strong>
    </div>
  );
}

// ─── Protected route wrapper ──────────────────────────────────────────────────
function Protected({ children, onNavigate }) {
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading && !session) onNavigate('signin');
  }, [session, loading]);
  if (loading) return <div className="auth-loading"><span className="eyebrow green">Loading…</span></div>;
  if (!session) return null;
  return children;
}

// ─── Shared data-view components ──────────────────────────────────────────────
function LoadingState({ label = 'Loading…' }) {
  return <div className="state-loading"><span className="eyebrow green">{label}</span></div>;
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="state-card">
      <div className="error-box"><span>{message}</span></div>
      {onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={26} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

// Status badge for investments and transactions.
const statusTone = {
  pending: 'warn', active: 'good', completed: 'good', cancelled: 'muted',
  rejected: 'bad', failed: 'bad',
};
function StatusBadge({ status }) {
  const tone = statusTone[status] || 'muted';
  return <span className={`status-badge ${tone}`}>{status}</span>;
}

// Plan card — read-only display of an investment plan's configured terms.
function PlanCard({ plan, onNavigate, onInvest, cashBalance, currency }) {
  const tone = riskTone[plan.risk_level] || 'mint';
  const rate = Number(plan.fixed_return_rate ?? plan.target_return ?? 0);
  const duration = plan.duration_days || 0;
  const minAmt = Number(plan.min_amount);
  const maxAmt = plan.max_amount ? Number(plan.max_amount) : null;
  const schedule = plan.payment_schedule || 'maturity';
  const scheduleLabel = schedule === 'monthly' ? 'Monthly payments' : 'Paid at maturity';
  const totalReturn = rate > 0 && duration > 0 ? (rate / 100) * (duration / 365) : 0;

  return (
    <div className="plan-card">
      <div className="plan-head">
        <div className={`coin ${tone}`}><Layers size={22} /></div>
        <div className="plan-head-info">
          <h3>{plan.name}</h3>
          <span className={`risk-pill ${tone}`}>{plan.risk_level}</span>
        </div>
      </div>
      {plan.description && <p className="plan-desc">{plan.description}</p>}
      <div className="plan-terms">
        <div><span>Fixed return</span><strong>{fmtPct(rate)} <small>APY</small></strong></div>
        <div><span>Duration</span><strong>{duration ? `${duration} days` : '—'}</strong></div>
        <div><span>Min – Max</span><strong>{fmtMoney(minAmt)}{maxAmt ? ` – ${fmtMoney(maxAmt)}` : '+'}</strong></div>
      </div>
      <div className="plan-terms">
        <div><span>Payments</span><strong>{scheduleLabel}</strong></div>
        <div><span>Est. return</span><strong className="green-text">{fmtPct(totalReturn * 100)}</strong></div>
        <div><span>Maturity</span><strong>Principal returned</strong></div>
      </div>
      {onInvest && (
        <Button onClick={() => onInvest(plan)} icon={ArrowUpRight}>Invest in this plan</Button>
      )}
      {!onInvest && onNavigate && (
        <Button variant="outline" onClick={() => onNavigate('portfolio')}>View portfolio <ArrowUpRight size={16} /></Button>
      )}
    </div>
  );
}

// Investment record row — shows plan name, principal, returns credited, total
// value, maturity date, and status.
function InvestmentRow({ inv, planName, currency }) {
  const principal = Number(inv.amount ?? 0);
  const returnsCredited = Number(inv.returns_credited ?? 0);
  const expectedReturn = Number(inv.expected_return ?? 0);
  const totalValue = principal + returnsCredited;
  const cur = currency || 'USD';

  return (
    <div className="inv-row">
      <div className="inv-main">
        <strong>{planName || 'Investment plan'}</strong>
        <span>Started {fmtDate(inv.started_at || inv.created_at)}{inv.maturity_date ? ` · Matures ${fmtDate(inv.maturity_date)}` : ''}</span>
      </div>
      <div className="inv-amount">
        <strong>{fmtMoney(principal, cur)}</strong>
        {returnsCredited > 0 ? (
          <span className="muted">Returns {fmtMoney(returnsCredited, cur)}</span>
        ) : expectedReturn > 0 ? (
          <span className="muted">Expected {fmtMoney(expectedReturn, cur)}</span>
        ) : null}
        {returnsCredited > 0 && (
          <span className="muted">Total {fmtMoney(totalValue, cur)}</span>
        )}
      </div>
      <StatusBadge status={inv.status} />
    </div>
  );
}

// ─── Live asset card with animated prices ─────────────────────────────────────
function LiveAssetCard({ coin, priceData, onClick, showDescription = true }) {
  const price = priceData?.price;
  const change = priceData?.change24h;
  return (
    <button className="asset-card live-asset-card" onClick={onClick}>
      <CoinLogo coin={coin} />
      <div className="asset-info">
        <h3>{coin.name}</h3>
        <span>{coin.symbol}</span>
        {showDescription && <p>{coin.description}</p>}
      </div>
      <div className="asset-value">
        <strong className="asset-price"><AnimatedPrice value={price} format={fmtCryptoPrice} /></strong>
        <AnimatedChange value={change} />
      </div>
      <span className="details">Details <ArrowUpRight size={16} /></span>
    </button>
  );
}

// ─── Testimonials section ─────────────────────────────────────────────────────
const testimonials = [
  { name: 'Sarah Chen', role: 'Long-term investor', initials: 'SC', rating: 5, text: 'Nexora Capital gave me a clear, stress-free way to manage my digital assets. The portfolio dashboard is exactly what I needed.' },
  { name: 'Marcus Reid', role: 'Crypto enthusiast', initials: 'MR', rating: 5, text: 'The live price tracking and investment plans are fantastic. I finally feel in control of my portfolio without constant app-hopping.' },
  { name: 'Elena Vasquez', role: 'New to digital assets', initials: 'EV', rating: 5, text: 'As someone just starting out, the platform is approachable and easy to understand. The fixed-return plans gave me confidence to begin.' },
  { name: 'David Okafor', role: 'Active trader', initials: 'DO', rating: 5, text: 'Real-time prices across twelve coins, clean charts, and instant withdrawals. Nexora nailed the details that matter to serious investors.' },
  { name: 'Priya Sharma', role: 'Portfolio builder', initials: 'PS', rating: 5, text: 'I love how everything lives in one place — deposits, investments, and live market data. The interface is calm and focused.' },
  { name: 'James Thompson', role: 'Retirement planner', initials: 'JT', rating: 5, text: 'The guaranteed fixed-return investment plans fit perfectly into my long-term strategy. Transparent terms, no surprises.' },
];

function StarRating({ count }) {
  return (
    <span className="star-rating">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      ))}
    </span>
  );
}

function TestimonialsSection() {
  return (
    <section className="testimonials-section page-pad">
      <div className="section-heading centered">
        <span className="eyebrow green">Loved by investors</span>
        <h2>What our community says.</h2>
        <p>Real experiences from people building their digital asset portfolios with Nexora Capital.</p>
      </div>
      <div className="testimonial-grid">
        {testimonials.map((t, i) => (
          <div className="testimonial-card" key={i}>
            <div className="testimonial-head">
              <div className="testimonial-avatar">{t.initials}</div>
              <div>
                <strong>{t.name}</strong>
                <span>{t.role}</span>
              </div>
            </div>
            <StarRating count={t.rating} />
            <p>"{t.text}"</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────
function HomePage({ onNavigate }) {
  const { prices, loading, lastUpdated, stale, live } = useCryptoPrices(true);
  return (
    <>
      <TopNav active="home" onNavigate={onNavigate} />
      <main>
        <section className="hero page-pad">
          <div className="hero-copy">
            <div className="pill"><Sparkles size={16} /> A fresh perspective on digital investing</div>
            <h1>Your future. <em>Your digital assets.</em></h1>
            <p>Explore digital assets with a clear portfolio overview and tools to help you make informed investment decisions.</p>
            <div className="hero-actions">
              <Button onClick={() => onNavigate('investments')} icon={ArrowUpRight}>Explore investments</Button>
              <Button variant="outline" onClick={() => onNavigate('signup')}>Get started</Button>
            </div>
            <div className="hero-trust"><ShieldCheck size={18} /> Built with clarity, security, and long-term thinking.</div>
          </div>
          <AppShowcase onNavigate={onNavigate} />
        </section>
        <section className="assets-section page-pad">
          <div className="section-heading">
            <div><span className="eyebrow green">Live market prices</span><h2>Build your perspective.</h2></div>
            <div className="assets-heading-right">
              <LiveDot live={live} stale={stale} />
              <button className="text-link" onClick={() => onNavigate('assets')}>View all assets <ArrowUpRight size={16} /></button>
            </div>
          </div>
          {loading ? (
            <div className="asset-grid">
              {COINS.slice(0, 6).map(coin => (
                <div className="asset-card live-asset-card loading-card" key={coin.symbol}>
                  <CoinLogo coin={coin} />
                  <div className="asset-info"><h3>{coin.name}</h3><span>{coin.symbol}</span><p>{coin.description}</p></div>
                  <div className="asset-value"><strong className="price-placeholder">—</strong><span className="muted">Loading…</span></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="asset-grid">
              {COINS.slice(0, 6).map(coin => (
                <LiveAssetCard key={coin.symbol} coin={coin} priceData={prices[coin.symbol]} onClick={() => onNavigate('assets')} />
              ))}
            </div>
          )}
          {stale && lastUpdated && (
            <p className="stale-notice">Showing last known prices. Live data is temporarily unavailable.</p>
          )}
        </section>
        <section className="features page-pad">
          <div className="section-heading centered">
            <span className="eyebrow green">Designed around you</span>
            <h2>Make every move more considered.</h2>
            <p>A calmer way to understand the market, organize your portfolio, and stay close to what matters.</p>
          </div>
          <div className="feature-grid">
            <Feature icon={PieChart} title="See the full picture" text="A clear view of your allocation and performance, without the noise." />
            <Feature icon={ShieldCheck} title="Security at the center" text="Thoughtful protections and transparent information at every step." />
            <Feature icon={BarChart3} title="Invest with context" text="Explore assets with the details you need to make your own decisions." />
          </div>
        </section>
        <TestimonialsSection />
        <section className="cta page-pad">
          <div>
            <span className="eyebrow">Your next chapter starts here</span>
            <h2>Move with more clarity.</h2>
            <p>Step into a more thoughtful digital asset experience.</p>
          </div>
          <Button onClick={() => onNavigate('signup')} icon={ArrowUpRight}>Create your account</Button>
        </section>
      </main>
      <Footer onNavigate={onNavigate} />
    </>
  );
}

// ─── All Assets page ──────────────────────────────────────────────────────────
function AssetsPage({ onNavigate }) {
  const { prices, loading, lastUpdated, stale, live, reload } = useCryptoPrices(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const filtered = COINS.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortBy === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (sortBy === 'price') { av = prices[a.symbol]?.price ?? 0; bv = prices[b.symbol]?.price ?? 0; }
    else if (sortBy === 'change') { av = prices[a.symbol]?.change24h ?? 0; bv = prices[b.symbol]?.change24h ?? 0; }
    else { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function toggleSort(col) {
    if (sortBy === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortBy(col); setSortDir(col === 'change' || col === 'price' ? 'desc' : 'asc'); }
  }

  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <>
      <TopNav active="assets" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <PageHeader eyebrow="Live market" title="All digital assets." text="Real-time USD prices for twelve leading cryptocurrencies, updated every 20 seconds." />

        <div className="assets-toolbar">
          <div className="assets-search">
            <Filter size={16} />
            <input
              type="text"
              placeholder="Search by name or ticker…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="assets-status">
            <LiveDot live={live} stale={stale} />
            <span className="muted last-updated">Updated {lastUpdatedLabel}</span>
          </div>
        </div>

        {stale && (
          <p className="stale-notice">Live data is temporarily unavailable. Showing last known prices.</p>
        )}

        {loading ? (
          <LoadingState label="Fetching live prices…" />
        ) : sorted.length === 0 ? (
          <div className="card">
            <EmptyState icon={Filter} title="No coins found" text="Try a different search term." />
          </div>
        ) : (
          <div className="assets-table card">
            <div className="assets-table-head">
              <button className={sortBy === 'name' ? 'active' : ''} onClick={() => toggleSort('name')}>Coin</button>
              <button className={`col-price ${sortBy === 'price' ? 'active' : ''}`} onClick={() => toggleSort('price')}>Price</button>
              <button className={`col-change ${sortBy === 'change' ? 'active' : ''}`} onClick={() => toggleSort('change')}>24h Change</button>
              <span className="col-action"></span>
            </div>
            {sorted.map(coin => {
              const pd = prices[coin.symbol];
              return (
                <div className="assets-table-row" key={coin.symbol}>
                  <div className="at-coin">
                    <CoinLogo coin={coin} size={40} />
                    <div><strong>{coin.name}</strong><span>{coin.symbol}</span></div>
                  </div>
                  <div className="at-price"><AnimatedPrice value={pd?.price} format={fmtCryptoPrice} /></div>
                  <div className="at-change"><AnimatedChange value={pd?.change24h} /></div>
                  <div className="at-action">
                    <button className="text-link" onClick={() => onNavigate('investments')}>Details <ArrowUpRight size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer onNavigate={onNavigate} />
    </>
  );
}

function InvestmentsPage({ onNavigate }) {
  const { session } = useAuth();
  const signedIn = !!session;
  const { prices } = useCryptoPrices(!signedIn);
  const { plans, loading: plansLoading, error: plansError, reload: reloadPlans } = useInvestmentPlans(signedIn);
  const data = usePortfolioData(signedIn);
  const [txModal, setTxModal] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [confirmResult, setConfirmResult] = useState(null);

  function openInvest(plan) {
    setSelectedPlan(plan);
    setTxModal('invest');
  }
  function closeTx() { setTxModal(null); setSelectedPlan(null); }

  const planNameById = {};
  plans.forEach(p => { planNameById[p.id] = p.name; });
  const activePlans = plans.filter(p => p.is_active);
  const cashBalance = Number(data.portfolio?.cash_balance ?? 0);
  const currency = data.portfolio?.currency || 'USD';

  return (
    <>
      <TopNav active="investments" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <PageHeader eyebrow="Explore investments" title="Choose with context." text="Browse available investment plans with guaranteed fixed returns and review your active investments." />

        <section className="plans-section">
          <div className="section-heading">
            <div><span className="eyebrow green">Available plans</span><h2>Investment plans</h2></div>
            {!signedIn && <button className="text-link" onClick={() => onNavigate('signin')}>Sign in to invest <ArrowUpRight size={16} /></button>}
          </div>

          {!signedIn ? (
            <div className="plan-grid">
              {COINS.slice(0, 3).map(coin => (
                <LiveAssetCard key={coin.symbol} coin={coin} priceData={prices[coin.symbol]} onClick={() => onNavigate('signin')} />
              ))}
            </div>
          ) : plansLoading ? (
            <LoadingState label="Loading plans…" />
          ) : plansError ? (
            <ErrorState message={plansError} onRetry={reloadPlans} />
          ) : activePlans.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Layers}
                title="No investment plans available yet"
                text="When plans are configured, they will appear here with their terms, minimum amounts, and durations."
              />
            </div>
          ) : (
            <div className="plan-grid">
              {activePlans.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onInvest={openInvest}
                  onNavigate={onNavigate}
                  cashBalance={cashBalance}
                  currency={currency}
                />
              ))}
            </div>
          )}
        </section>

        {signedIn && (
          <section className="inv-section">
            <div className="section-heading">
              <div><span className="eyebrow green">Your investments</span><h2>Active records</h2></div>
              <button className="text-link" onClick={() => onNavigate('portfolio')}>View portfolio <ArrowUpRight size={16} /></button>
            </div>
            <div className="card inv-card">
              {data.loading ? (
                <LoadingState label="Loading your investments…" />
              ) : data.error ? (
                <ErrorState message={data.error} onRetry={data.reload} />
              ) : data.investments.length === 0 ? (
                <EmptyState icon={Inbox} title="No investments yet" text="Your investment records will appear here once you start one." />
              ) : (
                data.investments.map(inv => <InvestmentRow key={inv.id} inv={inv} planName={planNameById[inv.plan_id]} currency={currency} />)
              )}
            </div>
          </section>
        )}

        {signedIn && txModal === 'invest' && (
          <TxModal
            open={true}
            mode="invest"
            onClose={closeTx}
            cashBalance={cashBalance}
            currency={currency}
            plans={plans}
            preselectedPlanId={selectedPlan?.id}
            onDone={data.reload}
            onInvestSuccess={setConfirmResult}
            onNavigate={onNavigate}
          />
        )}

        {signedIn && confirmResult && (
          <InvestmentConfirmation
            open={!!confirmResult}
            result={confirmResult}
            onClose={() => setConfirmResult(null)}
            onNavigate={onNavigate}
            currency={currency}
          />
        )}

        <div className="disclaimer">
          <ShieldCheck size={20} />
          <div>
            <strong>Guaranteed fixed returns</strong>
            <p>Returns are calculated from the plan's stored rate and duration, credited by the platform after admin verification. Terms are set by Nexora Capital and cannot be changed by customers.</p>
          </div>
        </div>
      </main>
      <Footer onNavigate={onNavigate} />
    </>
  );
}

function PortfolioPage({ onNavigate }) {
  return (
    <Protected onNavigate={onNavigate}>
      <PortfolioContent onNavigate={onNavigate} />
    </Protected>
  );
}

function PortfolioContent({ onNavigate }) {
  const { plans } = useInvestmentPlans(true);
  const data = usePortfolioData(true);
  const { portfolio, holdings, investments, transactions, loading, error, reload } = data;
  const currency = portfolio?.currency || 'USD';

  const planNameById = {};
  plans.forEach(p => { planNameById[p.id] = p.name; });

  // Allocations by holding quantity * average_cost (cost basis, not market value).
  const holdingsWithBasis = holdings.map(h => ({
    ...h,
    costBasis: Number(h.quantity) * Number(h.average_cost),
  }));
  const totalCostBasis = holdingsWithBasis.reduce((s, h) => s + h.costBasis, 0);
  const cashBalance = Number(portfolio?.cash_balance ?? 0);
  const portfolioValue = totalCostBasis + cashBalance;

  return (
    <>
      <TopNav active="portfolio" onNavigate={onNavigate} />
      <main className="page-pad inner-page portfolio-page">
        <PageHeader eyebrow="My portfolio" title="Your assets at a glance." text="A clear view of your portfolio balance, holdings, and recent activity." />

        {loading ? (
          <LoadingState label="Loading your portfolio…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
        <>
          <div className="portfolio-balance">
            <div>
              <span className="eyebrow">Total portfolio value</span>
              <h2>{fmtMoney(portfolioValue, currency)}</h2>
              <span className="muted">Cash {fmtMoney(cashBalance, currency)} · Holdings {fmtMoney(totalCostBasis, currency)}</span>
            </div>
            <div className="balance-actions">
              <Button onClick={() => onNavigate('investments')}>Invest <ArrowUpRight size={17} /></Button>
              <Button variant="dark-outline" onClick={() => onNavigate('dashboard')}>Dashboard</Button>
            </div>
          </div>

          <div className="metrics">
            <Metric label="Cash balance" value={fmtMoney(cashBalance, currency)} />
            <Metric label="Holdings cost basis" value={fmtMoney(totalCostBasis, currency)} green={totalCostBasis > 0} />
          </div>

          <h2 className="subheading">Your assets</h2>
          {holdings.length === 0 ? (
            <div className="card">
              <EmptyState icon={Wallet} title="No holdings yet" text="Assets you hold will appear here once your portfolio is active." action={<Button variant="outline" onClick={() => onNavigate('investments')}>Explore investments <ArrowUpRight size={16} /></Button>} />
            </div>
          ) : (
            <div className="holding-list">
              {holdingsWithBasis.map(h => {
                const tone = symbolTone[h.asset_symbol] || 'mint';
                const Icon = symbolIcon[h.asset_symbol] || CircleDollarSign;
                return (
                  <div className="holding-row" key={h.id}>
                    <div className={`mini-coin ${tone}`}><Icon size={18} /></div>
                    <div><strong>{h.asset_name}</strong><span>{fmtQty(h.quantity, h.asset_symbol)}</span></div>
                    <div className="holding-basis">
                      <strong>{fmtMoney(h.costBasis, currency)}</strong>
                      <span className="muted">avg {fmtMoney(h.average_cost, currency)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="subheading">Investments</h2>
          <div className="card inv-card">
            {investments.length === 0 ? (
              <EmptyState icon={Inbox} title="No investments yet" text="Your investment records will appear here once you start one." action={<Button variant="outline" onClick={() => onNavigate('investments')}>View plans <ArrowUpRight size={16} /></Button>} />
            ) : (
              investments.map(inv => <InvestmentRow key={inv.id} inv={inv} planName={planNameById[inv.plan_id]} currency={currency} />)
            )}
          </div>

          <h2 className="subheading">Recent activity</h2>
          <div className="card">
            {transactions.length === 0 ? (
              <EmptyState icon={Clock3} title="No activity yet" text="Deposits, withdrawals, and investment activity will show up here." />
            ) : (
              <div className="activity">
                {transactions.map(tx => (
                  <div className="activity-row" key={tx.id}>
                    <div className="activity-icon"><ActivityIcon type={tx.type} /></div>
                    <div><strong>{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</strong><span>{fmtDate(tx.processed_at || tx.created_at)}</span></div>
                    <div className="activity-right">
                      <strong>{fmtMoney(tx.amount, currency)}</strong>
                      <StatusBadge status={tx.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {transactions.length > 0 && (
              <div className="card-footer-link">
                <button className="text-link" onClick={() => onNavigate('transactions')}>View full transaction history <ArrowUpRight size={16} /></button>
              </div>
            )}
          </div>
        </>
        )}
      </main>
      <Footer onNavigate={onNavigate} />
    </>
  );
}

function ActivityIcon({ type }) {
  if (type === 'deposit') return <Plus size={17} />;
  if (type === 'withdrawal') return <ArrowUpRight size={17} />;
  if (type === 'investment') return <BarChart3 size={17} />;
  return <Clock3 size={17} />;
}

function DashboardPage({ onNavigate }) {
  return (
    <Protected onNavigate={onNavigate}>
      <DashboardContent onNavigate={onNavigate} />
    </Protected>
  );
}

function DashboardContent({ onNavigate }) {
  const { session, profile } = useAuth();
  const email = session?.user?.email ?? '';
  const name = profile?.display_name || '';
  const { plans } = useInvestmentPlans(true);
  const data = usePortfolioData(true);
  const { portfolio, holdings, investments, transactions, loading, error, reload } = data;
  const currency = portfolio?.currency || 'USD';
  const [txModal, setTxModal] = useState(null);
  const [confirmResult, setConfirmResult] = useState(null);

  function openTx(mode) { setTxModal(mode); }
  function closeTx() { setTxModal(null); }

  const planNameById = {};
  plans.forEach(p => { planNameById[p.id] = p.name; });

  const holdingsWithBasis = holdings.map(h => ({
    ...h,
    costBasis: Number(h.quantity) * Number(h.average_cost),
  }));
  const totalCostBasis = holdingsWithBasis.reduce((s, h) => s + h.costBasis, 0);
  const cashBalance = Number(portfolio?.cash_balance ?? 0);
  const portfolioValue = totalCostBasis + cashBalance;

  // Allocation percentages by cost basis.
  const allocTotal = totalCostBasis || 1;
  const allocations = holdingsWithBasis
    .map(h => ({ ...h, pct: (h.costBasis / allocTotal) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  // Build a conic-gradient for the allocation ring from real holdings.
  const colors = ['#f8a61f', '#6279d9', '#00a878', '#8b9a93'];
  let acc = 0;
  const stops = allocations.length ? allocations.map((h, i) => {
    const start = (acc / allocTotal) * 100;
    acc += h.costBasis;
    const end = (acc / allocTotal) * 100;
    return `${colors[i % colors.length]} ${start}% ${end}%`;
  }) : ['#e5ede8 0% 100%'];
  const ringGradient = `conic-gradient(${stops.join(', ')})`;
  const allocatedPct = totalCostBasis > 0 ? Math.round((totalCostBasis / (totalCostBasis + cashBalance || 1)) * 100) : 0;

  return (
    <>
      <TopNav active="portfolio" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <div className="dashboard-welcome">
          <div>
            <span className="eyebrow green">Overview</span>
            <h1>Welcome back{name ? `, ${name}` : ''}.</h1>
            <p className="dash-email">{email}</p>
          </div>
          <div className="dashboard-actions">
            <Button onClick={() => openTx('deposit')} icon={Plus}>Deposit</Button>
            <Button variant="outline" onClick={() => openTx('withdraw')}>Withdraw</Button>
            <Button variant="outline" onClick={() => openTx('invest')}>Invest <ArrowUpRight size={17} /></Button>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading your dashboard…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
        <>
          <div className="dashboard-grid">
            <div className="card big-balance">
              <span className="eyebrow">Total portfolio value</span>
              <h2>{fmtMoney(portfolioValue, currency)}</h2>
              <span className="muted">Cash {fmtMoney(cashBalance, currency)} · Holdings {fmtMoney(totalCostBasis, currency)}</span>
              <div className="dash-breakdown">
                <div><span>Cash</span><strong>{fmtMoney(cashBalance, currency)}</strong></div>
                <div><span>Holdings</span><strong>{fmtMoney(totalCostBasis, currency)}</strong></div>
                <div><span>Active investments</span><strong>{investments.filter(i => i.status === 'active' || i.status === 'pending').length}</strong></div>
              </div>
            </div>
            <div className="card allocation">
              <div className="card-title"><h3>Asset allocation</h3><MoreHorizontal size={20} /></div>
              <div className="allocation-ring" style={{ background: ringGradient }}>
                <div><strong>{allocatedPct}%</strong><span>allocated</span></div>
              </div>
              {allocations.length === 0 ? (
                <p className="muted alloc-empty">No holdings to allocate yet.</p>
              ) : (
                <div className="allocation-legend">
                  {allocations.map((h, i) => (
                    <span key={h.id}><i style={{ background: colors[i % colors.length] }} />{h.asset_name} <b>{Math.round(h.pct)}%</b></span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="dashboard-columns">
            <div className="card">
              <div className="card-title"><h3>Recent activity</h3><button className="text-link" onClick={() => onNavigate('transactions')}>View all</button></div>
              {transactions.length === 0 ? (
                <EmptyState icon={Clock3} title="No activity yet" text="Your transaction history will appear here." />
              ) : (
                <div className="activity">
                  {transactions.slice(0, 6).map(tx => (
                    <div className="activity-row" key={tx.id}>
                      <div className="activity-icon"><ActivityIcon type={tx.type} /></div>
                      <div><strong>{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</strong><span>{fmtDate(tx.processed_at || tx.created_at)}</span></div>
                      <div className="activity-right">
                        <strong>{fmtMoney(tx.amount, currency)}</strong>
                        <StatusBadge status={tx.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-title"><h3>Holdings</h3><button className="text-link" onClick={() => onNavigate('portfolio')}>View portfolio</button></div>
              {holdings.length === 0 ? (
                <EmptyState icon={Wallet} title="No holdings yet" text="Assets you hold will appear here." />
              ) : (
                holdingsWithBasis.slice(0, 6).map(h => {
                  const tone = symbolTone[h.asset_symbol] || 'mint';
                  const Icon = symbolIcon[h.asset_symbol] || CircleDollarSign;
                  return (
                    <div className="holding-row" key={h.id}>
                      <div className={`mini-coin ${tone}`}><Icon size={16} /></div>
                      <div><strong>{h.asset_name}</strong><span>{fmtQty(h.quantity, h.asset_symbol)}</span></div>
                      <div className="holding-basis">
                        <strong>{fmtMoney(h.costBasis, currency)}</strong>
                        <span className="muted">avg {fmtMoney(h.average_cost, currency)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="card inv-card dash-investments">
            <div className="card-title"><h3>Your investments</h3><button className="text-link" onClick={() => onNavigate('investments')}>View all</button></div>
            {investments.length === 0 ? (
              <EmptyState icon={Inbox} title="No investments yet" text="Start an investment from the plans page." action={<Button variant="outline" onClick={() => onNavigate('investments')}>View plans <ArrowUpRight size={16} /></Button>} />
            ) : (
              investments.slice(0, 5).map(inv => <InvestmentRow key={inv.id} inv={inv} planName={planNameById[inv.plan_id]} currency={currency} />)
            )}
          </div>
        </>
        )}
      </main>
      <TxModal
        open={!!txModal}
        mode={txModal}
        onClose={closeTx}
        cashBalance={cashBalance}
        currency={currency}
        plans={plans}
        onDone={reload}
        onInvestSuccess={setConfirmResult}
        onNavigate={onNavigate}
      />
      <InvestmentConfirmation
        open={!!confirmResult}
        result={confirmResult}
        onClose={() => setConfirmResult(null)}
        onNavigate={onNavigate}
        currency={currency}
      />
    </>
  );
}

// ─── Transaction history page ─────────────────────────────────────────────────
function TransactionsPage({ onNavigate }) {
  return (
    <Protected onNavigate={onNavigate}>
      <TransactionsContent onNavigate={onNavigate} />
    </Protected>
  );
}

function useTransactions(enabled) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('id,portfolio_id,type,amount,status,reference,description,processed_at,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setItems(data ?? []);
    } catch {
      setItems([]);
      setError('We could not load your transaction history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { items, loading, error, reload: load };
}

function TransactionsContent({ onNavigate }) {
  const { items, loading, error, reload } = useTransactions(true);
  const [filter, setFilter] = useState('all');

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'deposit', label: 'Deposits' },
    { value: 'withdrawal', label: 'Withdrawals' },
    { value: 'investment', label: 'Investments' },
  ];
  const filtered = filter === 'all' ? items : items.filter(t => t.type === filter);

  return (
    <>
      <TopNav active="transactions" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <PageHeader eyebrow="Activity" title="Transaction history." text="A complete record of your deposits, withdrawals, and investments, newest first." />

        <div className="admin-filters">
          {filters.map(f => (
            <button
              key={f.value}
              className={filter === f.value ? 'active' : ''}
              onClick={() => setFilter(f.value)}
            >{f.label}</button>
          ))}
        </div>

        {loading ? (
          <LoadingState label="Loading your transactions…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : filtered.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Clock3}
              title={items.length === 0 ? "No transactions yet" : "No matches for this filter"}
              text={items.length === 0 ? "Your deposits, withdrawals, and investment activity will appear here." : "Try a different filter to see other transaction types."}
              action={items.length === 0 ? <Button variant="outline" onClick={() => onNavigate('dashboard')}>Go to dashboard <ArrowUpRight size={16} /></Button> : null}
            />
          </div>
        ) : (
          <div className="card tx-history-card">
            <div className="tx-history-list">
              {filtered.map(tx => (
                <div className="tx-history-row" key={tx.id}>
                  <div className="tx-history-icon"><ActivityIcon type={tx.type} /></div>
                  <div className="tx-history-main">
                    <strong>{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</strong>
                    <span className="muted">{fmtDate(tx.processed_at || tx.created_at)}</span>
                    {tx.reference && <span className="tx-ref">Ref: {tx.reference}</span>}
                    {tx.description && <span className="tx-desc muted">{tx.description}</span>}
                  </div>
                  <div className="tx-history-right">
                    <strong>{fmtMoney(tx.amount)}</strong>
                    <StatusBadge status={tx.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      <Footer onNavigate={onNavigate} />
    </>
  );
}

// ─── Support page ────────────────────────────────────────────────────────────
function SupportPage({ onNavigate }) {
  return (
    <Protected onNavigate={onNavigate}>
      <SupportContent onNavigate={onNavigate} />
    </Protected>
  );
}

function SupportContent({ onNavigate }) {
  const { session } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id,subject,body,status,transaction_id,created_at,updated_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTickets(data ?? []);
    } catch {
      setTickets([]); setError('We could not load your support requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const selected = tickets.find(t => t.id === selectedId);

  return (
    <>
      <TopNav active="support" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <div className="section-heading">
          <div>
            <span className="eyebrow green">Support</span>
            <h1>How can we help?</h1>
          </div>
          <Button onClick={() => setShowForm(true)} icon={Plus}>New request</Button>
        </div>

        {loading ? (
          <LoadingState label="Loading your support requests…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : selected ? (
          <TicketDetail
            ticket={selected}
            onBack={() => setSelectedId(null)}
            onReload={reload}
            session={session}
          />
        ) : tickets.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Headphones}
              title="No support requests yet"
              text="If you need help with a deposit, withdrawal, or investment, create a request and our team will respond."
              action={<Button onClick={() => setShowForm(true)} icon={Plus}>New request</Button>}
            />
          </div>
        ) : (
          <div className="card inv-card">
            {tickets.map(t => (
              <button key={t.id} className="ticket-row" onClick={() => setSelectedId(t.id)}>
                <div className="ticket-info">
                  <strong>{t.subject}</strong>
                  <span>{fmtDate(t.created_at)}</span>
                </div>
                <StatusBadge status={t.status} />
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        )}
      </main>
      <Footer onNavigate={onNavigate} />
      {showForm && (
        <NewTicketModal
          open={showForm}
          onClose={() => setShowForm(false)}
          onDone={() => { setShowForm(false); reload(); }}
        />
      )}
    </>
  );
}

function NewTicketModal({ open, onClose, onDone }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [txRef, setTxRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (open) { setSubject(''); setBody(''); setTxRef(''); setErrors([]); }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    if (!subject.trim()) { setErrors(['Please add a subject.']); return; }
    if (!body.trim()) { setErrors(['Please describe your issue.']); return; }
    setLoading(true);
    try {
      const payload = { subject: subject.trim(), body: body.trim() };
      if (txRef.trim()) {
        const { data: tx } = await supabase
          .from('transactions')
          .select('id')
          .eq('reference', txRef.trim())
          .maybeSingle();
        if (tx) payload.transaction_id = tx.id;
      }
      const { error } = await supabase.from('support_tickets').insert(payload);
      if (error) throw error;
      onDone();
    } catch {
      setErrors(['We could not submit your request. Please try again.']);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New support request" eyebrow="Get help">
      <form className="tx-form" onSubmit={handleSubmit} noValidate>
        {errors.length > 0 && (
          <div className="error-box">{errors.map((er, i) => <span key={i}>{er}</span>)}</div>
        )}
        <label className="full">Subject
          <input value={subject} onChange={ev => setSubject(ev.target.value)} maxLength={120} placeholder="Brief summary of your issue" />
        </label>
        <label className="full">Message
          <textarea value={body} onChange={ev => setBody(ev.target.value)} rows={4} maxLength={1000} placeholder="Describe your issue in detail" />
        </label>
        <label className="full">Transaction reference (optional)
          <input value={txRef} onChange={ev => setTxRef(ev.target.value)} placeholder="e.g. TX-AB12CD" />
        </label>
        <Button type="submit" disabled={loading}>
          {loading ? 'Submitting…' : 'Submit request'}
          {!loading && <Send size={17} />}
        </Button>
      </form>
    </Modal>
  );
}

function TicketDetail({ ticket, onBack, onReload, session }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id,sender_id,sender_role,body,created_at')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data ?? []);
    } catch {
      setError('We could not load the conversation.');
    } finally {
      setLoading(false);
    }
  }, [ticket.id]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  async function handleReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.from('support_messages').insert({
        ticket_id: ticket.id,
        sender_id: session.user.id,
        sender_role: 'customer',
        body: reply.trim(),
      });
      if (error) throw error;
      setReply('');
      await loadMessages();
      onReload();
    } catch {
      setError('We could not send your message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card ticket-detail">
      <button className="back-home" onClick={onBack}>← Back to support</button>
      <div className="ticket-detail-head">
        <div>
          <h2>{ticket.subject}</h2>
          <span className="muted">Opened {fmtDate(ticket.created_at)}</span>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="ticket-body">{ticket.body}</p>

      <h3 className="subheading">Conversation</h3>
      {loading ? (
        <LoadingState label="Loading conversation…" />
      ) : error ? (
        <div className="error-box"><span>{error}</span></div>
      ) : messages.length === 0 ? (
        <p className="muted">No replies yet. Our team will respond shortly.</p>
      ) : (
        <div className="conversation">
          {messages.map(m => (
            <div key={m.id} className={`msg ${m.sender_role}`}>
              <div className="msg-bubble">
                <strong>{m.sender_role === 'staff' ? 'Support staff' : 'You'}</strong>
                <p>{m.body}</p>
              </div>
              <span className="muted msg-time">{fmtDate(m.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {ticket.status !== 'closed' && (
        <form className="tx-form reply-form" onSubmit={handleReply}>
          <label className="full">Your reply
            <textarea value={reply} onChange={ev => setReply(ev.target.value)} rows={3} maxLength={1000} placeholder="Write a reply…" />
          </label>
          <Button type="submit" disabled={sending || !reply.trim()}>
            {sending ? 'Sending…' : 'Send reply'}
            {!sending && <Send size={17} />}
          </Button>
        </form>
      )}
    </div>
  );
}

// ─── Admin dashboard ─────────────────────────────────────────────────────────
function AdminPage({ onNavigate }) {
  return (
    <Protected onNavigate={onNavigate}>
      <AdminContent onNavigate={onNavigate} />
    </Protected>
  );
}

function AdminContent({ onNavigate }) {
  const { isAdmin } = useAuth();

  const [tab, setTab] = useState('transactions');
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); setItems([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        let query = supabase
          .from(tab === 'transactions' ? 'transactions' : 'investments')
          .select(tab === 'transactions'
            ? 'id,reference,type,amount,status,description,admin_notes,processed_by,processed_at,created_at,portfolio_id,tx_hash,receipt_path'
            : 'id,reference,amount,status,admin_notes,processed_by,started_at,completed_at,created_at,plan_id,portfolio_id,expected_return,maturity_date,returns_credited'
          )
          .order('created_at', { ascending: false });
        if (filter !== 'all') query = query.eq('status', filter);
        const { data, error } = await query.limit(50);
        if (error) throw error;
        if (!cancelled) setItems(data ?? []);
      } catch {
        if (!cancelled) { setItems([]); setError('We could not load the admin queue.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, filter, reloadKey, isAdmin]);

  const selected = items.find(i => i.id === selectedId);

  if (!isAdmin) {
    return (
      <>
        <TopNav active="admin" onNavigate={onNavigate} />
        <main className="page-pad inner-page">
          <div className="card">
            <EmptyState
              icon={ShieldX}
              title="Administrator access required"
              text="You do not have permission to view this page. Only authorized administrators can review and process transactions."
              action={<Button variant="outline" onClick={() => onNavigate('dashboard')}>Back to dashboard</Button>}
            />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopNav active="admin" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <div className="section-heading">
          <div>
            <span className="eyebrow green">Admin</span>
            <h1>Transaction review</h1>
          </div>
        </div>

        <div className="admin-tabs">
          <button className={tab === 'transactions' ? 'active' : ''} onClick={() => { setTab('transactions'); setFilter('all'); setSelectedId(null); }}>Transactions</button>
          <button className={tab === 'investments' ? 'active' : ''} onClick={() => { setTab('investments'); setFilter('all'); setSelectedId(null); }}>Investments</button>
          <button className={tab === 'support' ? 'active' : ''} onClick={() => { setTab('support'); setFilter('all'); setSelectedId(null); }}>Support</button>
          <button className={tab === 'kyc' ? 'active' : ''} onClick={() => { setTab('kyc'); setSelectedId(null); }}>KYC</button>
          <button className={tab === 'plans' ? 'active' : ''} onClick={() => { setTab('plans'); setSelectedId(null); }}>Plans</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => { setTab('settings'); setSelectedId(null); }}>Deposit settings</button>
        </div>

        {tab !== 'support' && tab !== 'settings' && tab !== 'plans' && tab !== 'kyc' && (
          <div className="admin-filters">
            <Filter size={16} />
            {['all','pending','approved','processing','completed','cancelled','rejected','failed','active'].map(s => (
              <button
                key={s}
                className={filter === s ? 'active' : ''}
                onClick={() => { setFilter(s); setSelectedId(null); }}
              >{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        )}

        {tab === 'support' ? (
          <AdminSupport onNavigate={onNavigate} />
        ) : tab === 'settings' ? (
          <AdminBtcConfig />
        ) : tab === 'kyc' ? (
          <AdminKyc />
        ) : tab === 'plans' ? (
          <AdminPlanManagement />
        ) : loading ? (
          <LoadingState label="Loading queue…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : selected ? (
          <AdminDetail
            item={selected}
            type={tab}
            onBack={() => setSelectedId(null)}
            onAction={reload}
          />
        ) : items.length === 0 ? (
          <div className="card">
            <EmptyState icon={Inbox} title="No requests to review" text="There are no items matching the current filter." />
          </div>
        ) : (
          <div className="card inv-card">
            {items.map(item => (
              <button key={item.id} className="admin-row" onClick={() => setSelectedId(item.id)}>
                <div className="admin-row-main">
                  <strong>{item.reference || 'No ref'}</strong>
                  <span className="muted">{tab === 'transactions' ? item.type : 'Investment'} · {fmtMoney(item.amount)}</span>
                </div>
                <StatusBadge status={item.status} />
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function AdminSupport({ onNavigate }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data, error } = await supabase
          .from('support_tickets')
          .select('id,subject,body,status,transaction_id,user_id,created_at,updated_at')
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        if (!cancelled) setTickets(data ?? []);
      } catch {
        if (!cancelled) { setTickets([]); setError('We could not load support tickets.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const selected = tickets.find(t => t.id === selectedId);

  if (selected) {
    return <AdminTicketDetail ticket={selected} onBack={() => setSelectedId(null)} onAction={() => setReloadKey(k => k + 1)} />;
  }

  if (loading) return <LoadingState label="Loading support tickets…" />;
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey(k => k + 1)} />;
  if (tickets.length === 0) {
    return <div className="card"><EmptyState icon={Headphones} title="No support tickets" text="There are no support requests to review." /></div>;
  }
  return (
    <div className="card inv-card">
      {tickets.map(t => (
        <button key={t.id} className="admin-row" onClick={() => setSelectedId(t.id)}>
          <div className="admin-row-main">
            <strong>{t.subject}</strong>
            <span className="muted">{fmtDate(t.created_at)}</span>
          </div>
          <StatusBadge status={t.status} />
          <ArrowUpRight size={16} />
        </button>
      ))}
    </div>
  );
}

function AdminTicketDetail({ ticket, onBack, onAction }) {
  const { session } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id,sender_id,sender_role,body,created_at')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data ?? []);
    } catch {
      setError('We could not load the conversation.');
    } finally {
      setLoading(false);
    }
  }, [ticket.id]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  async function handleReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.from('support_messages').insert({
        ticket_id: ticket.id,
        sender_id: session.user.id,
        sender_role: 'staff',
        body: reply.trim(),
      });
      if (error) throw error;
      await supabase.from('support_tickets').update({ status: 'answered', assigned_to: session.user.id }).eq('id', ticket.id);
      setReply('');
      await loadMessages();
      onAction();
    } catch {
      setError('We could not send the reply.');
    } finally {
      setSending(false);
    }
  }

  async function closeTicket() {
    try {
      const { error } = await supabase.from('support_tickets').update({ status: 'closed' }).eq('id', ticket.id);
      if (error) throw error;
      onAction();
      onBack();
    } catch {
      setError('We could not close the ticket.');
    }
  }

  return (
    <div className="card ticket-detail">
      <button className="back-home" onClick={onBack}>← Back to admin queue</button>
      <div className="ticket-detail-head">
        <div>
          <h2>{ticket.subject}</h2>
          <span className="muted">Opened {fmtDate(ticket.created_at)}</span>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="ticket-body">{ticket.body}</p>

      <h3 className="subheading">Conversation</h3>
      {loading ? (
        <LoadingState label="Loading conversation…" />
      ) : error ? (
        <div className="error-box"><span>{error}</span></div>
      ) : messages.length === 0 ? (
        <p className="muted">No replies yet.</p>
      ) : (
        <div className="conversation">
          {messages.map(m => (
            <div key={m.id} className={`msg ${m.sender_role}`}>
              <div className="msg-bubble">
                <strong>{m.sender_role === 'staff' ? 'Staff' : 'Customer'}</strong>
                <p>{m.body}</p>
              </div>
              <span className="muted msg-time">{fmtDate(m.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      <form className="tx-form reply-form" onSubmit={handleReply}>
        <label className="full">Reply as staff
          <textarea value={reply} onChange={ev => setReply(ev.target.value)} rows={3} maxLength={1000} placeholder="Write a reply to the customer…" />
        </label>
        <div className="settings-actions">
          <Button type="submit" disabled={sending || !reply.trim()} icon={Send}>
            {sending ? 'Sending…' : 'Send reply'}
          </Button>
          {ticket.status !== 'closed' && (
            <Button variant="outline" onClick={closeTicket}>Close ticket</Button>
          )}
        </div>
      </form>
    </div>
  );
}

// Admin-only: configure the Bitcoin receiving wallet address shown to customers
// on the deposit form. Reads/writes go through RLS-protected app_settings; the
// write goes through the admin_update_btc_address SECURITY DEFINER function
// which validates the address format server-side.
function AdminBtcConfig() {
  const [address, setAddress] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErrors([]);
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('btc_receive_address')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      const val = data?.btc_receive_address ?? '';
      setAddress(val); setOriginal(val);
    } catch {
      setErrors(['We could not load the current Bitcoin address.']);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e) {
    e.preventDefault();
    setErrors([]); setInfo('');
    const trimmed = address.trim();
    if (trimmed && !(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed) || /^bc1[a-z0-9]{6,58}$/.test(trimmed))) {
      setErrors(['That does not look like a valid Bitcoin address (legacy, SegWit, or Bech32).']);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_update_btc_address', { p_address: trimmed || null });
      if (error) throw error;
      setOriginal(trimmed);
      setInfo(trimmed ? 'Bitcoin receiving address updated.' : 'Bitcoin receiving address cleared.');
    } catch (err) {
      const msg = err && err.message ? err.message : '';
      if (msg.includes('administrator') || msg.includes('admin')) {
        setErrors(['Only administrators can change this address.']);
      } else if (msg.includes('valid')) {
        setErrors([msg]);
      } else {
        setErrors(['We could not save the address. Please try again.']);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card btc-config-card">
      <div className="card-title">
        <div><h3>Bitcoin deposit address</h3><p>This address is shown to customers on the deposit form. Customers send BTC to it and submit a receipt for your review.</p></div>
      </div>

      {loading ? (
        <LoadingState label="Loading settings…" />
      ) : (
        <form className="settings-fields" onSubmit={handleSave}>
          {errors.length > 0 && (
            <div className="error-box">{errors.map((er, i) => <span key={i}>{er}</span>)}</div>
          )}
          {info && (
            <div className="success-box compact"><Check size={18} /><span>{info}</span></div>
          )}
          <label className="full">Bitcoin receiving wallet address
            <input
              value={address}
              onChange={ev => setAddress(ev.target.value)}
              placeholder="e.g. bc1q… or 1A1zP1…"
              maxLength={90}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="muted">Leave blank to disable deposits. Only a public receiving address is stored — never enter private keys or seed phrases here.</p>
          <div className="settings-actions">
            <Button type="submit" disabled={saving || address.trim() === original.trim()}>
              {saving ? 'Saving…' : 'Save address'}
            </Button>
            {original && address.trim() !== original && (
              <Button variant="outline" onClick={() => setAddress(original)}>Cancel</Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// Renders a download link for a deposit receipt stored in the private
// deposit-receipts bucket. The signed URL is short-lived and scoped to the
// caller's RLS permissions — admins can download any receipt, customers only
// their own.
function ReceiptLink({ path }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data, error } = await supabase.storage
          .from('deposit-receipts')
          .createSignedUrl(path, 60);
        if (error) throw error;
        if (!cancelled) setUrl(data.signedUrl);
      } catch {
        if (!cancelled) setError('Could not load receipt.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (loading) return <p className="muted">Loading receipt…</p>;
  if (error) return <p className="muted">{error}</p>;
  return (
    <a className="receipt-link" href={url} target="_blank" rel="noopener noreferrer">
      <Upload size={15} /> View receipt
    </a>
  );
}

function AdminKyc() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data, error } = await supabase
          .from('kyc_applications')
          .select('id,user_id,legal_name,date_of_birth,country,document_type,document_path,status,admin_feedback,reviewed_by,reviewed_at,created_at,updated_at')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        if (!cancelled) setApps(data ?? []);
      } catch {
        if (!cancelled) { setApps([]); setError('We could not load KYC applications.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const selected = apps.find(a => a.id === selectedId);

  if (selected) {
    return <AdminKycDetail app={selected} onBack={() => setSelectedId(null)} onAction={() => setReloadKey(k => k + 1)} />;
  }
  if (loading) return <LoadingState label="Loading KYC applications…" />;
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey(k => k + 1)} />;
  if (apps.length === 0) {
    return <div className="card"><EmptyState icon={ShieldCheck} title="No verification applications" text="There are no KYC applications to review." /></div>;
  }
  return (
    <div>
      <div className="section-heading">
        <div><span className="eyebrow green">Identity verification</span><h2>KYC applications</h2></div>
      </div>
      <div className="card inv-card">
        {apps.map(a => (
          <button key={a.id} className="admin-row" onClick={() => setSelectedId(a.id)}>
            <div className="admin-row-main">
              <strong>{a.legal_name}</strong>
              <span className="muted">{a.country} · {a.document_type.replace(/_/g, ' ')} · {fmtDate(a.created_at)}</span>
            </div>
            <StatusBadge status={a.status === 'resubmission_required' ? 'bad' : a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'bad' : 'warn'} />
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminKycDetail({ app, onBack, onAction }) {
  const [feedback, setFeedback] = useState('');
  const [acting, setActing] = useState(false);
  const [errors, setErrors] = useState([]);
  const [info, setInfo] = useState('');

  async function handleReview(decision) {
    setErrors([]); setInfo(''); setActing(true);
    try {
      const { error } = await supabase.rpc('admin_review_kyc', {
        p_application_id: app.id,
        p_decision: decision,
        p_feedback: feedback || null,
      });
      if (error) throw error;
      setInfo(decision === 'approved' ? 'Application approved.' : decision === 'rejected' ? 'Application rejected.' : 'Resubmission requested.');
      setFeedback('');
      setTimeout(() => { onAction(); onBack(); }, 800);
    } catch {
      setErrors(['We could not complete this action.']);
    } finally {
      setActing(false);
    }
  }

  const countryName = COUNTRIES.find(c => c.code === app.country)?.name || app.country;
  const docTypeLabel = DOC_TYPE_OPTIONS.find(d => d.value === app.document_type)?.label || app.document_type;

  return (
    <div className="card admin-detail">
      <button className="back-home" onClick={onBack}>← Back to applications</button>
      <div className="ticket-detail-head">
        <div>
          <h2>{app.legal_name}</h2>
          <span className="muted">{countryName} · Submitted {fmtDate(app.created_at)}</span>
        </div>
        <StatusBadge status={app.status === 'approved' ? 'good' : app.status === 'pending' ? 'warn' : 'bad'} />
      </div>

      <div className="admin-detail-grid">
        <div>
          <h3 className="subheading">Applicant details</h3>
          <div className="detail-row"><span>Legal name</span><strong>{app.legal_name}</strong></div>
          <div className="detail-row"><span>Date of birth</span><strong>{fmtDate(app.date_of_birth)}</strong></div>
          <div className="detail-row"><span>Country</span><strong>{countryName}</strong></div>
          <div className="detail-row"><span>Document type</span><strong>{docTypeLabel}</strong></div>
          <div className="detail-row"><span>Status</span><strong>{app.status}</strong></div>
          {app.reviewed_at && <div className="detail-row"><span>Reviewed</span><strong>{fmtDate(app.reviewed_at)}</strong></div>}
          {app.admin_feedback && <div className="detail-row"><span>Feedback</span><strong>{app.admin_feedback}</strong></div>}

          <div className="btc-verify-box">
            <h4 className="btc-verify-title"><FileText size={16} /> Identity document</h4>
            <KycDocLink path={app.document_path} />
            <p className="btc-verify-warn">Verify the document matches the applicant's name and date of birth before approving. The link expires after 60 seconds.</p>
          </div>
        </div>

        <div>
          <h3 className="subheading">Review actions</h3>
          {errors.length > 0 && <div className="error-box">{errors.map((er, i) => <span key={i}>{er}</span>)}</div>}
          {info && <div className="success-box compact"><Check size={18} /><span>{info}</span></div>}
          {app.status === 'pending' ? (
            <>
              <label className="full admin-note-label">Feedback (required for rejection or resubmission)
                <textarea value={feedback} onChange={ev => setFeedback(ev.target.value)} maxLength={500} rows={3} placeholder="Reason for rejection or resubmission instructions…" />
              </label>
              <div className="admin-action-buttons">
                <Button onClick={() => handleReview('approved')} disabled={acting}>
                  {acting ? 'Working…' : 'Approve'}
                </Button>
                <Button variant="outline" onClick={() => handleReview('rejected')} disabled={acting}>
                  {acting ? 'Working…' : 'Reject'}
                </Button>
                <Button variant="outline" onClick={() => handleReview('resubmission_required')} disabled={acting}>
                  {acting ? 'Working…' : 'Request resubmission'}
                </Button>
              </div>
            </>
          ) : (
            <p className="muted">This application has already been reviewed.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminPlanManagement() {
  const { plans, loading, error, reload } = useInvestmentPlans(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  function startEdit(plan) {
    setEditing(plan.id);
    setForm({
      fixed_return_rate: plan.fixed_return_rate ?? '',
      min_amount: plan.min_amount ?? '',
      max_amount: plan.max_amount ?? '',
      duration_days: plan.duration_days ?? '',
      payment_schedule: plan.payment_schedule ?? 'maturity',
      return_calc_method: plan.return_calc_method ?? 'simple',
      is_active: plan.is_active,
      description: plan.description ?? '',
    });
    setSaveError(''); setSaveSuccess('');
  }

  function cancelEdit() {
    setEditing(null); setForm({}); setSaveError(''); setSaveSuccess('');
  }

  async function handleSave(planId) {
    setSaving(true); setSaveError(''); setSaveSuccess('');
    try {
      const params = {
        p_plan_id: planId,
        p_fixed_return_rate: form.fixed_return_rate !== '' ? parseFloat(form.fixed_return_rate) : null,
        p_min_amount: form.min_amount !== '' ? parseFloat(form.min_amount) : null,
        p_max_amount: form.max_amount !== '' ? parseFloat(form.max_amount) : null,
        p_duration_days: form.duration_days !== '' ? parseInt(form.duration_days, 10) : null,
        p_payment_schedule: form.payment_schedule || null,
        p_return_calc_method: form.return_calc_method || null,
        p_is_active: form.is_active,
        p_description: form.description || null,
      };
      const { error } = await supabase.rpc('admin_update_plan', params);
      if (error) throw error;
      setSaveSuccess('Plan updated successfully.');
      setEditing(null);
      setTimeout(() => { reload(); setSaveSuccess(''); }, 800);
    } catch {
      setSaveError('Could not update the plan. Please check the values and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading plans…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div>
      <div className="section-heading">
        <div><span className="eyebrow green">Plan management</span><h2>Investment plans</h2></div>
      </div>
      {saveError && <div className="error-box"><span>{saveError}</span></div>}
      {saveSuccess && <div className="success-box compact"><Check size={18} /><span>{saveSuccess}</span></div>}
      <div className="plan-grid">
        {plans.map(plan => (
          <div className="plan-card admin-plan-card" key={plan.id}>
            <div className="plan-head">
              <div className={`coin ${riskTone[plan.risk_level] || 'mint'}`}><Layers size={22} /></div>
              <div className="plan-head-info">
                <h3>{plan.name}</h3>
                <span className={`risk-pill ${riskTone[plan.risk_level] || 'mint'}`}>{plan.risk_level}</span>
              </div>
            </div>

            {editing === plan.id ? (
              <div className="plan-edit-form">
                <label className="full">Fixed return rate (% APY)
                  <input type="number" step="0.1" value={form.fixed_return_rate}
                    onChange={e => setForm({ ...form, fixed_return_rate: e.target.value })} />
                </label>
                <label className="full">Minimum amount
                  <input type="number" step="0.01" value={form.min_amount}
                    onChange={e => setForm({ ...form, min_amount: e.target.value })} />
                </label>
                <label className="full">Maximum amount
                  <input type="number" step="0.01" value={form.max_amount}
                    onChange={e => setForm({ ...form, max_amount: e.target.value })} />
                </label>
                <label className="full">Duration (days)
                  <input type="number" value={form.duration_days}
                    onChange={e => setForm({ ...form, duration_days: e.target.value })} />
                </label>
                <label className="full">Payment schedule
                  <select value={form.payment_schedule}
                    onChange={e => setForm({ ...form, payment_schedule: e.target.value })}>
                    <option value="maturity">At maturity</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label className="full">Calculation method
                  <select value={form.return_calc_method}
                    onChange={e => setForm({ ...form, return_calc_method: e.target.value })}>
                    <option value="simple">Simple</option>
                    <option value="compound">Compound</option>
                  </select>
                </label>
                <label className="full">Description
                  <textarea rows={3} value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })} maxLength={500} />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                  <span>Plan is active (visible to customers)</span>
                </label>
                <div className="admin-action-buttons">
                  <Button onClick={() => handleSave(plan.id)} disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                  <Button variant="outline" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                {plan.description && <p className="plan-desc">{plan.description}</p>}
                <div className="plan-terms">
                  <div><span>Fixed return</span><strong>{fmtPct(Number(plan.fixed_return_rate ?? 0))} <small>APY</small></strong></div>
                  <div><span>Duration</span><strong>{plan.duration_days} days</strong></div>
                  <div><span>Min – Max</span><strong>{fmtMoney(Number(plan.min_amount))}{plan.max_amount ? ` – ${fmtMoney(Number(plan.max_amount))}` : '+'}</strong></div>
                </div>
                <div className="plan-terms">
                  <div><span>Payments</span><strong>{plan.payment_schedule === 'monthly' ? 'Monthly' : 'At maturity'}</strong></div>
                  <div><span>Method</span><strong>{plan.return_calc_method}</strong></div>
                  <div><span>Active</span><strong>{plan.is_active ? 'Yes' : 'No'}</strong></div>
                </div>
                <Button variant="outline" onClick={() => startEdit(plan)}>Edit plan</Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminDetail({ item, type, onBack, onAction }) {
  const [audit, setAudit] = useState([]);
  const [note, setNote] = useState('');
  const [extRef, setExtRef] = useState('');
  const [acting, setActing] = useState(false);
  const [errors, setErrors] = useState([]);
  const [info, setInfo] = useState('');

  const isTx = type === 'transactions';
  const status = item.status;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('transaction_audit')
          .select('id,from_status,to_status,actor_role,note,reference,created_at')
          .eq('record_type', isTx ? 'transaction' : 'investment')
          .eq('record_id', item.id)
          .order('created_at', { ascending: true });
        if (!cancelled) setAudit(data ?? []);
      } catch {
        if (!cancelled) setAudit([]);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id, isTx]);

  async function doAction(fn, p, label) {
    setErrors([]); setInfo(''); setActing(true);
    try {
      const { error } = await supabase.rpc(fn, p);
      if (error) throw error;
      setInfo(`${label} completed.`);
      setNote(''); setExtRef('');
      setTimeout(() => { onAction(); onBack(); }, 800);
    } catch {
      setErrors([`We could not complete this action.`]);
    } finally {
      setActing(false);
    }
  }

  const actions = isTx ? [
    { fn: 'admin_approve_transaction', p: { p_tx_id: item.id }, label: 'Approve', show: status === 'pending', variant: 'primary' },
    { fn: 'admin_process_transaction', p: { p_tx_id: item.id, p_note: note || null, p_reference: extRef || null }, label: 'Move to processing', show: status === 'approved', variant: 'primary' },
    { fn: 'admin_complete_transaction', p: { p_tx_id: item.id }, label: 'Mark completed', show: status === 'processing', variant: 'primary' },
    { fn: 'admin_fail_transaction', p: { p_tx_id: item.id, p_note: note || null }, label: 'Mark failed', show: ['processing','approved','pending'].includes(status), variant: 'outline' },
    { fn: 'admin_reject_transaction', p: { p_tx_id: item.id, p_note: note || null }, label: 'Reject', show: ['pending','approved','processing'].includes(status), variant: 'outline' },
  ] : [
    { fn: 'admin_approve_investment', p: { p_inv_id: item.id }, label: 'Approve', show: status === 'pending', variant: 'primary' },
    { fn: 'admin_activate_investment', p: { p_inv_id: item.id }, label: 'Activate (calculate returns)', show: status === 'approved', variant: 'primary' },
    { fn: 'admin_process_return_credits', p: { p_inv_id: item.id, p_period_number: 1 }, label: 'Credit return payment', show: status === 'active', variant: 'primary' },
    { fn: 'admin_reject_investment', p: { p_inv_id: item.id, p_note: note || null }, label: 'Reject', show: ['pending','approved'].includes(status), variant: 'outline' },
  ];

  return (
    <div className="card admin-detail">
      <button className="back-home" onClick={onBack}>← Back to queue</button>
      <div className="ticket-detail-head">
        <div>
          <h2>{item.reference || 'No reference'}</h2>
          <span className="muted">{isTx ? item.type : 'Investment'} · {fmtMoney(item.amount)} · Created {fmtDate(item.created_at)}</span>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div className="admin-detail-grid">
        <div>
          <h3 className="subheading">Details</h3>
          {isTx && <div className="detail-row"><span>Type</span><strong>{item.type}</strong></div>}
          <div className="detail-row"><span>Amount</span><strong>{fmtMoney(item.amount)}</strong></div>
          <div className="detail-row"><span>Status</span><strong>{item.status}</strong></div>
          {item.description && <div className="detail-row"><span>Description</span><strong>{item.description}</strong></div>}
          {item.admin_notes && <div className="detail-row"><span>Admin notes</span><strong>{item.admin_notes}</strong></div>}
          {item.processed_at && <div className="detail-row"><span>Processed</span><strong>{fmtDate(item.processed_at)}</strong></div>}
          {!isTx && item.started_at && <div className="detail-row"><span>Started</span><strong>{fmtDate(item.started_at)}</strong></div>}
          {!isTx && item.maturity_date && <div className="detail-row"><span>Maturity date</span><strong>{fmtDate(item.maturity_date)}</strong></div>}
          {!isTx && item.expected_return != null && <div className="detail-row"><span>Expected return</span><strong>{fmtMoney(item.expected_return)}</strong></div>}
          {!isTx && <div className="detail-row"><span>Returns credited</span><strong>{fmtMoney(item.returns_credited || 0)}</strong></div>}
          {!isTx && item.completed_at && <div className="detail-row"><span>Completed</span><strong>{fmtDate(item.completed_at)}</strong></div>}

          {isTx && item.type === 'deposit' && (
            <div className="btc-verify-box">
              <h4 className="btc-verify-title"><ShieldCheck size={16} /> Bitcoin verification</h4>
              {item.tx_hash ? (
                <div className="detail-row"><span>BTC tx hash</span><code className="btc-hash">{item.tx_hash}</code></div>
              ) : (
                <p className="muted">No transaction hash provided by the customer.</p>
              )}
              {item.receipt_path ? (
                <ReceiptLink path={item.receipt_path} />
              ) : (
                <p className="muted">No receipt uploaded.</p>
              )}
              <p className="btc-verify-warn">Before marking completed, confirm the BTC transaction was received at the configured wallet address and the amount is sufficient. A screenshot alone is not proof of payment.</p>
            </div>
          )}

          {!isTx && status === 'active' && (
            <div className="return-credit-box">
              <h4 className="btc-verify-title"><BarChart3 size={16} /> Return management</h4>
              <p className="muted">Click "Credit return payment" to process the next return installment for this investment. The system prevents duplicate credits automatically.</p>
              <div className="detail-row"><span>Expected return</span><strong>{fmtMoney(item.expected_return || 0)}</strong></div>
              <div className="detail-row"><span>Already credited</span><strong>{fmtMoney(item.returns_credited || 0)}</strong></div>
            </div>
          )}
        </div>

        <div>
          <h3 className="subheading">Actions</h3>
          {errors.length > 0 && <div className="error-box">{errors.map((er, i) => <span key={i}>{er}</span>)}</div>}
          {info && <div className="success-box compact"><Check size={18} /><span>{info}</span></div>}
          <label className="full admin-note-label">Admin note (recorded with the action)
            <input value={note} onChange={ev => setNote(ev.target.value)} maxLength={300} placeholder="Note or reason" />
          </label>
          {isTx && status === 'approved' && (
            <label className="full admin-note-label">External reference
              <input value={extRef} onChange={ev => setExtRef(ev.target.value)} maxLength={100} placeholder="e.g. Wire confirmation number" />
            </label>
          )}
          <div className="admin-action-buttons">
            {actions.filter(a => a.show).map(a => (
              <Button
                key={a.label}
                variant={a.variant}
                disabled={acting}
                onClick={() => doAction(a.fn, a.p, a.label)}
              >{acting ? 'Working…' : a.label}</Button>
            ))}
            {actions.filter(a => a.show).length === 0 && (
              <p className="muted">No actions available for this status.</p>
            )}
          </div>
        </div>
      </div>

      <h3 className="subheading">Audit history</h3>
      {audit.length === 0 ? (
        <p className="muted">No audit entries yet.</p>
      ) : (
        <div className="audit-log">
          {audit.map(a => (
            <div className="audit-row" key={a.id}>
              <span className="audit-status">
                <strong>{a.to_status}</strong>
                {a.from_status && <span className="muted">from {a.from_status}</span>}
              </span>
              <span className="muted">{a.actor_role}</span>
              {a.note && <span className="muted">“{a.note}”</span>}
              {a.reference && <span className="muted">ref: {a.reference}</span>}
              <span className="muted">{fmtDate(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Auth page ────────────────────────────────────────────────────────────────
function validate(email, password, isSignup) {
  const errs = [];
  if (!email.trim()) errs.push('Email address is required.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('Please enter a valid email address.');
  if (!password) errs.push('Password is required.');
  else if (isSignup && password.length < 8) errs.push('Password must be at least 8 characters.');
  return errs;
}

function AuthPage({ mode, onNavigate }) {
  const signup = mode === 'signup';
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed]     = useState(false);
  const [errors, setErrors]     = useState([]);
  const [success, setSuccess]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Clear transient state when switching between signin/signup modes.
  useEffect(() => {
    setErrors([]); setSuccess(''); setResetSent(false);
  }, [mode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setSuccess('');

    const errs = validate(email, password, signup);
    if (signup && !fullName.trim()) errs.push('Full name is required.');
    if (signup && !agreed) errs.push('You must agree to the terms to continue.');
    if (errs.length) { setErrors(errs); return; }

    setLoading(true);
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('already registered') ||
              msg.includes('already exists') ||
              msg.includes('user already')) {
            setErrors(['An account with that email already exists. Try signing in instead.']);
          } else if (msg.includes('password') || msg.includes('weak')) {
            setErrors(['Please choose a stronger password.']);
          } else {
            setErrors(['We could not create your account. Please try again.']);
          }
          return;
        }
        setSuccess('Account created. Signing you in…');
        const { error: signinErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!signinErr) { onNavigate('dashboard'); return; }
        setSuccess('Account created! You can now sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          // Neutral message: do not reveal whether the email exists.
          setErrors(['The email or password is incorrect. Please try again.']);
          return;
        }
        onNavigate('dashboard');
      }
    } catch {
      setErrors(['Something went wrong. Please check your connection and try again.']);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      setErrors(['Enter your email address above first, then tap "Send reset link".']);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors(['Please enter a valid email address.']);
      return;
    }
    setErrors([]);
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        // Neutral message regardless of whether the account exists.
        setResetSent(true);
      } else {
        setResetSent(true);
      }
    } catch {
      setResetSent(true);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-brand">
        <button onClick={() => onNavigate('home')}><Logo /></button>
        <div className="auth-quote">
          <Sparkles size={24} />
          <h2>Digital assets, thoughtfully.</h2>
          <p>A clearer way to explore what's next.</p>
        </div>
        <span>© 2026 Nexora Capital</span>
      </div>
      <div className="auth-panel">
        <button className="back-home" onClick={() => onNavigate('home')}>← Back to home</button>
        <div className="auth-form-wrap">
          <span className="eyebrow green">{signup ? 'Create your account' : 'Welcome back'}</span>
          <h1>{signup ? 'Start with clarity.' : 'Sign in to Nexora.'}</h1>
          <p>{signup ? 'Create a secure space to understand and manage your digital assets.' : 'Your portfolio is waiting for you.'}</p>

          {success && (
            <div className="success-box">
              <Check size={20} />
              <strong>{success}</strong>
            </div>
          )}

          {errors.length > 0 && (
            <div className="error-box">
              {errors.map((e, i) => <span key={i}>{e}</span>)}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {signup && (
              <label>
                Full name
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={ev => setFullName(ev.target.value)}
                  autoComplete="name"
                  maxLength={60}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={ev => setEmail(ev.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              {signup ? 'Create password' : 'Password'}
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={ev => setPassword(ev.target.value)}
                autoComplete={signup ? 'new-password' : 'current-password'}
              />
            </label>
            {signup && (
              <label className="checkbox">
                <input type="checkbox" checked={agreed} onChange={ev => setAgreed(ev.target.checked)} />
                <span>I agree to the terms and privacy policy.</span>
              </label>
            )}
            <Button type="submit" disabled={loading}>
              {loading ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
              {!loading && <ArrowUpRight size={17} />}
            </Button>
          </form>

          {!signup && (
            <div className="auth-reset">
              {resetSent ? (
                <div className="success-box compact">
                  <Mail size={18} />
                  <span>If an account exists for that email, a reset link is on its way.</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-link"
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                >
                  {resetLoading ? 'Sending…' : 'Forgot your password?'}
                </button>
              )}
            </div>
          )}

          <div className="auth-switch">
            {signup ? 'Already have an account?' : 'New to Nexora?'}{' '}
            <button onClick={() => { setErrors([]); setSuccess(''); onNavigate(signup ? 'signin' : 'signup'); }}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────
function SettingsPage({ onNavigate }) {
  const { session, profile, profileLoading, refreshProfile } = useAuth();
  const email = session?.user?.email ?? '';

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl]   = useState('');
  const [bio, setBio]               = useState('');
  const [saving, setSaving]         = useState(false);
  const [savedMsg, setSavedMsg]     = useState('');
  const [errs, setErrs]             = useState([]);
  const [loadErr, setLoadErr]       = useState('');
  const initialized = useRef(false);

  // Populate form fields once the profile is available.
  useEffect(() => {
    if (profileLoading) return;
    if (!initialized.current) {
      setDisplayName(profile?.display_name ?? '');
      setAvatarUrl(profile?.avatar_url ?? '');
      setBio(profile?.bio ?? '');
      setLoadErr(profile ? '' : 'We could not load your profile. Please try again.');
      initialized.current = true;
    }
  }, [profile, profileLoading]);

  function initialsFor(name, mail) {
    const base = (name || '').trim();
    if (base) return base.slice(0, 2).toUpperCase();
    return mail ? mail.slice(0, 2).toUpperCase() : 'NC';
  }
  const initials = initialsFor(displayName, email);

  async function handleSave(e) {
    e.preventDefault();
    setErrs([]); setSavedMsg('');
    if (avatarUrl && !/^https?:\/\/.+/.test(avatarUrl)) {
      setErrs(['Avatar URL must start with http:// or https://.']);
      return;
    }
    if (bio && bio.length > 280) {
      setErrs(['Bio must be 280 characters or fewer.']);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName.trim() || null, avatar_url: avatarUrl.trim() || null, bio: bio.trim() || null })
        .eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      setSavedMsg('Profile updated.');
    } catch {
      setErrs(['We could not save your changes. Please try again.']);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    onNavigate('home');
  }

  return (
    <Protected onNavigate={onNavigate}>
      <TopNav active="portfolio" onNavigate={onNavigate} />
      <main className="page-pad inner-page settings-page">
        <PageHeader eyebrow="Account settings" title="Make it yours." text="Manage your profile details and preferences." />
        <div className="settings-layout">
          <aside className="settings-menu">
            <button className="selected">Profile</button>
            <button onClick={() => onNavigate('kyc')}>Identity verification</button>
            <button>Security</button>
            <button>Notifications</button>
            <button>Preferences</button>
          </aside>
          <div className="card settings-card">
            <div className="card-title">
              <div><h3>Profile details</h3><p>Your account information.</p></div>
            </div>

            {profileLoading ? (
              <div className="profile-loading"><span className="eyebrow green">Loading your profile…</span></div>
            ) : loadErr ? (
              <div className="error-box"><span>{loadErr}</span></div>
            ) : (
              <>
                <div className="profile-avatar">{initials}</div>
                <form className="settings-fields" onSubmit={handleSave}>
                  <label className="full">Email address<input value={email} readOnly /></label>
                  <label className="full">Account ID<input value={session?.user?.id ?? ''} readOnly /></label>
                  <label className="full">Display name
                    <input
                      value={displayName}
                      onChange={ev => setDisplayName(ev.target.value)}
                      placeholder="Add a display name"
                      maxLength={60}
                      autoComplete="name"
                    />
                  </label>
                  <label className="full">Avatar URL
                    <input
                      value={avatarUrl}
                      onChange={ev => setAvatarUrl(ev.target.value)}
                      placeholder="https://…"
                      type="url"
                      autoComplete="photo"
                    />
                  </label>
                  <label className="full">Bio
                    <textarea
                      value={bio}
                      onChange={ev => setBio(ev.target.value)}
                      placeholder="A short note about you"
                      maxLength={280}
                      rows={3}
                    />
                  </label>

                  {errs.length > 0 && (
                    <div className="error-box">{errs.map((er, i) => <span key={i}>{er}</span>)}</div>
                  )}
                  {savedMsg && (
                    <div className="success-box compact"><Check size={18} /><span>{savedMsg}</span></div>
                  )}

                  <div className="settings-actions">
                    <Button type="submit" disabled={saving} icon={saving ? undefined : Pencil}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                    <Button variant="outline" onClick={handleSignOut} icon={LogOut}>Sign out</Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </main>
      <Footer onNavigate={onNavigate} />
    </Protected>
  );
}

// ─── KYC / Identity Verification ──────────────────────────────────────────────
const KYC_DOC_MAX_BYTES = 10 * 1024 * 1024;
const KYC_DOC_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const COUNTRIES = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' }, { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' }, { code: 'CH', name: 'Switzerland' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'SG', name: 'Singapore' },
  { code: 'JP', name: 'Japan' }, { code: 'ZA', name: 'South Africa' },
  { code: 'BR', name: 'Brazil' }, { code: 'MX', name: 'Mexico' },
  { code: 'IN', name: 'India' }, { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' }, { code: 'GH', name: 'Ghana' },
  { code: 'OTHER', name: 'Other' },
];
const DOC_TYPE_OPTIONS = [
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'national_id', label: 'National ID Card' },
  { value: 'residence_permit', label: 'Residence Permit' },
];

function useKycApplication(enabled) {
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error } = await supabase
        .from('kyc_applications')
        .select('id,legal_name,date_of_birth,country,document_type,document_path,status,admin_feedback,reviewed_at,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setApplication(data);
    } catch {
      setApplication(null);
      setError('We could not load your verification status. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { application, loading, error, reload: load };
}

function KycDocLink({ path }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data, error } = await supabase.storage
          .from('kyc-documents')
          .createSignedUrl(path, 60);
        if (error) throw error;
        if (!cancelled) setUrl(data.signedUrl);
      } catch {
        if (!cancelled) setError('Could not load document.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (loading) return <p className="muted">Loading document…</p>;
  if (error) return <p className="muted">{error}</p>;
  return (
    <a className="receipt-link" href={url} target="_blank" rel="noopener noreferrer">
      <FileText size={15} /> View identity document
    </a>
  );
}

function KycPage({ onNavigate }) {
  return (
    <Protected onNavigate={onNavigate}>
      <KycContent onNavigate={onNavigate} />
    </Protected>
  );
}

function KycContent({ onNavigate }) {
  const { session, profile, refreshProfile } = useAuth();
  const { application, loading, error, reload } = useKycApplication(true);
  const [legalName, setLegalName] = useState('');
  const [dob, setDob] = useState('');
  const [country, setCountry] = useState('');
  const [docType, setDocType] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState('');

  const kycStatus = profile?.kyc_status || 'unverified';
  const canSubmit = kycStatus === 'unverified' || kycStatus === 'rejected' || kycStatus === 'resubmission' || !application || application.status === 'rejected' || application.status === 'resubmission_required';

  function validateDoc(file) {
    if (!file) return null;
    if (!KYC_DOC_TYPES.includes(file.type)) {
      return 'Document must be a PNG, JPEG, WebP, or PDF file.';
    }
    if (file.size > KYC_DOC_MAX_BYTES) {
      return 'Document must be 10 MB or smaller.';
    }
    return null;
  }

  function handleDocChange(e) {
    const file = e.target.files?.[0] ?? null;
    const err = validateDoc(file);
    if (err) { setErrors([err]); setDocFile(null); return; }
    setErrors([]); setDocFile(file);
  }

  async function uploadDoc(userId) {
    if (!docFile) return null;
    const ext = docFile.name.split('.').pop() || 'bin';
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 5) || 'bin';
    const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const { error } = await supabase.storage
      .from('kyc-documents')
      .upload(fileName, docFile, { contentType: docFile.type, upsert: false });
    if (error) throw new Error('We could not upload your document. Please try again.');
    return fileName;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]); setSuccess('');
    if (!legalName.trim()) { setErrors(['Legal name is required.']); return; }
    if (!dob) { setErrors(['Date of birth is required.']); return; }
    if (!country) { setErrors(['Country of residence is required.']); return; }
    if (!docType) { setErrors(['Document type is required.']); return; }
    if (!docFile) { setErrors(['Identity document is required.']); return; }

    setSubmitting(true);
    try {
      const userId = session?.user?.id;
      const docPath = await uploadDoc(userId);
      const { error } = await supabase.rpc('submit_kyc', {
        p_legal_name: legalName.trim(),
        p_date_of_birth: dob,
        p_country: country,
        p_document_type: docType,
        p_document_path: docPath,
      });
      if (error) throw error;
      setSuccess('Verification submitted. We will review your application and update the status.');
      await refreshProfile(userId);
      await reload();
      setLegalName(''); setDob(''); setCountry(''); setDocType(''); setDocFile(null);
    } catch (err) {
      const msg = err && err.message ? err.message : '';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setErrors(['You already have a verification application pending review.']);
      } else if (msg.includes('upload') || msg.includes('document')) {
        setErrors([msg]);
      } else {
        setErrors(['We could not submit your verification. Please try again.']);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const statusLabel = {
    unverified: 'Not submitted',
    pending: 'Pending review',
    verified: 'Approved',
    rejected: 'Rejected',
    resubmission: 'Resubmission required',
  };
  const statusClass = {
    unverified: 'muted', pending: 'warn', verified: 'good', rejected: 'bad', resubmission: 'bad',
  };

  return (
    <>
      <TopNav active="portfolio" onNavigate={onNavigate} />
      <main className="page-pad inner-page">
        <PageHeader eyebrow="Account" title="Identity verification." text="Complete identity verification to invest and withdraw. Your information is stored securely and reviewed by our team." />

        <div className="kyc-status-card card">
          <div className="kyc-status-head">
            <div className={`kyc-status-icon ${statusClass[kycStatus] || 'muted'}`}>
              {kycStatus === 'verified' ? <UserCheck size={24} /> : <ShieldCheck size={24} />}
            </div>
            <div>
              <span className="eyebrow green">Verification status</span>
              <h2>{statusLabel[kycStatus] || 'Not submitted'}</h2>
            </div>
          </div>
          {application?.admin_feedback && (kycStatus === 'rejected' || kycStatus === 'resubmission') && (
            <div className="kyc-feedback">
              <strong>Admin feedback:</strong>
              <p>{application.admin_feedback}</p>
            </div>
          )}
        </div>

        {loading ? (
          <LoadingState label="Loading verification status…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : kycStatus === 'pending' ? (
          <div className="card kyc-info-card">
            <p className="muted">Your verification application is under review. We will notify you once it has been processed. This usually takes 1–2 business days.</p>
            {application && <KycDocLink path={application.document_path} />}
          </div>
        ) : kycStatus === 'verified' ? (
          <div className="card kyc-info-card">
            <div className="success-box compact"><Check size={18} /><span>Your identity has been verified. You can now invest and withdraw.</span></div>
            <div className="admin-action-buttons">
              <Button onClick={() => onNavigate('investments')}>Browse investments <ArrowUpRight size={17} /></Button>
              <Button variant="outline" onClick={() => onNavigate('dashboard')}>Go to dashboard</Button>
            </div>
          </div>
        ) : canSubmit ? (
          <div className="card kyc-form-card">
            <h3 className="subheading">Submit verification</h3>
            {kycStatus === 'rejected' && (
              <div className="error-box"><span>Your previous application was rejected. Please review the feedback above and resubmit.</span></div>
            )}
            {kycStatus === 'resubmission' && (
              <div className="error-box"><span>Please resubmit your verification with the requested changes.</span></div>
            )}
            <form className="tx-form kyc-form" onSubmit={handleSubmit} noValidate>
              {errors.length > 0 && (
                <div className="error-box">{errors.map((er, i) => <span key={i}>{er}</span>)}</div>
              )}
              {success && (
                <div className="success-box compact"><Check size={18} /><span>{success}</span></div>
              )}
              <label className="full">Legal full name
                <input type="text" value={legalName} onChange={e => setLegalName(e.target.value)} maxLength={100} placeholder="As shown on your ID" autoComplete="name" />
              </label>
              <label className="full">Date of birth
                <input type="date" value={dob} onChange={e => setDob(e.target.value)} max="2010-12-31" />
              </label>
              <label className="full">Country of residence
                <select value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="">Select country…</option>
                  {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label className="full">Document type
                <select value={docType} onChange={e => setDocType(e.target.value)}>
                  <option value="">Select document type…</option>
                  {DOC_TYPE_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>
              <label className="full receipt-label">Identity document (PNG, JPEG, WebP, or PDF, max 10 MB)
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={handleDocChange} />
                {docFile && <span className="muted receipt-chosen">Selected: {docFile.name} ({(docFile.size / 1024).toFixed(0)} KB)</span>}
              </label>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit for review'}
                {!submitting && <ArrowUpRight size={17} />}
              </Button>
            </form>
          </div>
        ) : null}

        <div className="disclaimer">
          <ShieldCheck size={20} />
          <div>
            <strong>Why verification is required</strong>
            <p>Identity verification is required before you can invest or withdraw. Deposits are available without verification. Your document is stored in a private, access-controlled storage bucket and only reviewed by authorized administrators.</p>
          </div>
        </div>
      </main>
      <Footer onNavigate={onNavigate} />
    </>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
function App() {
  const [page, setPage]         = useState('home');
  const [session, setSession]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [profile, setProfile]   = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const refreshProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    setProfileLoading(true);
    try {
      const row = await fetchProfile(userId);
      setProfile(row);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session?.user?.id) refreshProfile(data.session.user.id);
    }).catch(() => {
      setLoading(false);
    });

    // onAuthStateChange fires synchronously; async work must be deferred to
    // avoid a deadlock when it calls other Supabase methods.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      (async () => {
        setSession(newSession);
        if (newSession?.user?.id) {
          await refreshProfile(newSession.user.id);
        } else {
          setProfile(null);
        }
        // After sign-out, return to the home page.
        if (event === 'SIGNED_OUT') setPage('home');
      })();
    });
    return () => subscription.unsubscribe();
  }, [refreshProfile]);

  const isAdmin = profile?.role === 'admin';

  const view =
    page === 'home'        ? <HomePage        onNavigate={setPage} /> :
    page === 'investments' ? <InvestmentsPage onNavigate={setPage} /> :
    page === 'assets'      ? <AssetsPage      onNavigate={setPage} /> :
    page === 'portfolio'   ? <PortfolioPage   onNavigate={setPage} /> :
    page === 'dashboard'   ? <DashboardPage   onNavigate={setPage} /> :
    page === 'transactions'? <TransactionsPage onNavigate={setPage} /> :
    page === 'support'     ? <SupportPage     onNavigate={setPage} /> :
    page === 'admin'       ? <AdminPage       onNavigate={setPage} /> :
    page === 'kyc'         ? <KycPage         onNavigate={setPage} /> :
    page === 'signin'      ? <AuthPage mode="signin" onNavigate={setPage} /> :
    page === 'signup'      ? <AuthPage mode="signup" onNavigate={setPage} /> :
                             <SettingsPage    onNavigate={setPage} />;

  return (
    <AuthCtx.Provider value={{ session, loading, profile, profileLoading, refreshProfile, isAdmin }}>
      <ErrorBoundary>{view}</ErrorBoundary>
    </AuthCtx.Provider>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.error('Nexora render error:', err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-loading">
          <span className="eyebrow green">Something went wrong</span>
          <h1>We couldn't load this page.</h1>
          <p>Please refresh the page. If the problem continues, sign out and back in.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<App />);

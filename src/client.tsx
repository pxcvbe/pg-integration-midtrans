/*
 * Coded M4Nually by: pxcvbe & Ivan.K
 * Date: 11/10/2026
 */

import { render } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";

const API = "http://localhost:3000"; // URL Backend Hono

type OrderStatus = "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded";
type OrderInfo = {
  id: string;
  status: OrderStatus;
  grossAmount: number;
  paymentType: string | null;
  snapToken: string | null;
}

// === Snap.js === //
type SnapCallbacks = {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
}
declare global {
  interface Window {
    snap?: {
      pay(token: string, options?: SnapCallbacks): void
    };
  }
}

// Snap.js itu dimuat sekali, URL dan client key diambil dari backend
// (sandbox/production cukup diganti lewat files `.env` di backend)
let snapLoading: Promise<void> | null = null;
function loadSnap(): Promise<void> {
  if (window.snap) return Promise.resolve();
  snapLoading ??= fetch(`${API}/api/config`)
    .then((r) => r.json())
    .then(
      (cfg: { snapJsUrl: string; clientKey: string }) =>
        new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = cfg.snapJsUrl;
          script.setAttribute("data-client-key", cfg.clientKey);
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Gagal memuat Snap.js"));
          document.head.appendChild(script);
        }),
    )
    .catch((e) => {
      snapLoading = null; // boleh dicoba lagi
      throw e;
    });
  return snapLoading;
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

function App() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [grossAmount, setGrossAmount] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderInfo | null>(null);
  
  const [loading, setLoading] = useState(false);

  // Polling status order ke backend sampai statusnya final.
  // Callback Snap.js tidak dipercaya: status lunas HANYA dari backend.
  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API}/api/orders/${orderId}`);
        if (!res.ok || stopped) return;
        const data: OrderInfo = await res.json();
        if (stopped) return;
        setOrder(data);
        if (data.status !== "pending") clearInterval(timer);
      } catch {
        /* coba lag di tick berikutnya */
      }
    };
    const timer = setInterval(tick, 3000);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [orderId]);

  async function openSnap(token: string) {
    try {
      await loadSnap();
      window.snap!.pay(token, {
        onSuccess: () => { },
        onPending: () => { },
        onError: () => setError("Pembayaran gagal, silahkan coba lagi."),
        onClose: () => { }, // popup ditutup: order tetap pending, bisa dibuka lagi
      });
    } catch (e) {
      const msg = (e as Error).message;
      // Snap.js menolak pay() kalau popup sedang terbuka. Itu bukan kesalahan
      // popup-nya memang sudah tampil, jadi cukup diabaikan.
      if (/not allowed to be called in this state/i.test(msg)) return;
      setError(msg);
    }
  }

  async function pay() {
    // Ref (sinkron mencegah klik ganda, state `submitting` baru berlaku setelah render ulang)
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone, grossAmount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal membuat order");
      setOrder(null);
      setOrderId(data.orderId);
      await openSnap(data.snapToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function reset() {
    setOrderId(null);
    setOrder(null);
    setError("");
  }

  const waiting = orderId !== null && (!order || order.status === "pending");

  return (
    <div class="form-payment">
      <h1>Testing Payment Gateway Midtrans</h1>

      <div className="form-group">
        {/* INPUT FIRST NAME */}
        <label htmlFor="firstName">First Name:</label>
        <input
          id="firstName"
          type="text"
          value={firstName}
          onInput={e => setFirstName(e.currentTarget.value)}
        />
      </div>

      <div className="form-group">
        {/* INPUT LAST NAME */}
        <label htmlFor="lastName">Last Name:</label>
        <input
          id="lastName"
          type="text"
          value={lastName}
          onInput={e => setLastName(e.currentTarget.value)}
        />
      </div>

      <div className="form-group">
        {/* INPUT EMAIL */}
        <label htmlFor="email">Email:</label>
        <input
          id="email"
          type="email"
          value={email}
          onInput={e => setEmail(e.currentTarget.value)}
        />
      </div>

      <div className="form-group">
        {/* INPUT PHONE */}
        <label htmlFor="phone">Phone:</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onInput={e => setPhone(e.currentTarget.value)}
        />
      </div>

      <div className="form-group">
        {/* INPUT GROSS AMOUNT */}
        <label htmlFor="grossAmount">Gross Amount:</label>
        <input
          id="grossAmount"
          type="number"
          value={grossAmount}
          onInput={e => setGrossAmount(e.currentTarget.valueAsNumber)}
        />
      </div>

      <div className="preview-info">
        <p><strong>Test Input First Name:</strong> {firstName}</p>
        <p><strong>Test Input Last Name:</strong> {lastName}</p>
        <p><strong>Test Input Email:</strong> {email}</p>
        <p><strong>Test Input Phone:</strong> {phone}</p>
        <p><strong>Test Input Gross Amount:</strong> {grossAmount}</p>
      </div>

      <div className="form-group">
        <button
          className="pay-button"
          onClick={pay}
          disabled={submitting || waiting}
        >
          {submitting ? "Memproses..." : "Pay!"}
        </button>
      </div>

      {error && <p class="payment-error" role="alert">{error}</p>}

      {orderId && (
        <div class="payment-status" data-status={order?.status ?? "loading"}>
          {!order && <p>Memuat status pembayaran...</p>}
          {order?.status === "pending" && (
            <>
              <p>Menunggu pembayaran Rp{order?.grossAmount.toLocaleString("id-ID")}...</p>
              {order.snapToken && (
                <button type="button" onClick={() => openSnap(order.snapToken!)}>
                  Buka popup pembayaran
                </button>
              )}
            </>
          )}
          {order?.status === "paid" && (
            <>
              <p>Pembayaran berhasil{order.paymentType ? ` (${order.paymentType})` : ""}.</p>
            </>
          )}
          {order && order.status !== "pending" && order.status !== "paid" && (
            <>
              <p>Pembayaran {order.status}.</p>
              <button type="button" onClick={reset}>Coba lagi</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

render(<App />, root)

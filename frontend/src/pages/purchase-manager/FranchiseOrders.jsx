// Franchise Orders: the FOFO orders this kitchen has to fulfil.
//
// A franchise-owned outlet buys its supplies from us through the partner app.
// Once an order is PAID FOR it comes to the kitchen that serves that outlet
// (docs/fofo-dashboard-spec.md §8.3, §8.4), and two people move it on:
//
//   the purchase manager    ACCEPTS it. The stock leaves the kitchen's books in
//                           that step, so it is confirmed first.
//   the kitchen executive   PACKS it, and prints the shipping label for the box.
//
// ONE SCREEN, TWO VIEWS (`role`, see VIEWS below). The purchase manager's
// dashboard routes to it; the kitchen executive's dashboard renders it with
// role="kitchen_executive". The views differ in which orders are listed, how
// they are grouped, what the notice says and which button an order carries.
// Everything else is shared, which is the point: both people are looking at the
// same orders. The server enforces all of it again: each role is sent only the
// orders it may see, and each change is refused for the other role.
//
// WHICH ORDERS. Unpaid checkouts never appear: they are not orders yet. A
// kitchen executive sees an order only once it has been accepted; before that
// there is nothing to pack.
//
// EVERY CHANGE IS ONE DATABASE FUNCTION (fofo.accept_order, migration 16;
// fofo.mark_order_packed, 22). This screen asks for it and shows the answer,
// including a refusal in the server's own words. A button being on or off here
// is a courtesy read from data that may have moved; the database decides.
//
// NOT YET: accepting less than was ordered (a trim, which needs a credit
// note), the logistics invoice and shipping. While the kitchen is short on any
// line Accept is off and says why; the way through today is to stock in.
//
// THE LABEL is drawn in the browser (lib/shippingLabelPdf.js) from what the
// server says belongs on it, for any order that has been accepted. Printing it
// is not recorded and is not required before packing.
//
// WHERE THE DATA COMES FROM. Not Supabase: the partner app's server, through
// lib/fofoStaffApi.js, which needs a staff pass (decision 0023). When there is
// no working pass the calls throw StaffPassRequired and this screen shows the
// key prompt in place of the list. That is expected for anyone who logged in
// before passes existed, not an error.
//
// THE COUNT behind the notice on each dashboard belongs to that dashboard,
// which polls for it (hooks/useFranchiseOrdersSummary.js) and hands it in as
// `shell`: through the router's outlet context for the purchase manager, as a
// prop for the kitchen executive. This page reloads its list whenever that
// count changes, so a new order appears without a refresh, and calls
// shell.refresh() after anything that changes it.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import jsPDF from 'jspdf'
import { ORDER_STATUS, fofoStaffApi } from '../../lib/fofoStaffApi'
import { StaffPassRequired } from '../../lib/staffPass'
import { moneyExact, quantity } from '../../lib/formatNumbers'
import { buildShippingLabelPdf, printPdf, shippingLabelFileName } from '../../lib/shippingLabelPdf'
import StaffPassPrompt from '../../components/StaffPassPrompt'
import { useToast } from '../../context/toastContext'
import { useConfirm } from '../../context/confirmContext'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'

const DONE = ['delivered', 'cancelled']
// A label makes sense once the order is accepted, and stops once it is over.
const LABEL_STATUSES = ['accepted', 'packed', 'ready_to_ship', 'shipped']

// What each role sees. `attention` is the status that asks this person to act:
// its section comes first, its rows are tinted, and the notice counts it.
// `since` is the moment that order started waiting on them.
const VIEWS = {
  purchase_manager: {
    intro:
      'Supplies ordered and paid for by franchise-owned outlets that your kitchen serves. Each order waits here until you accept it; only then is it packed.',
    attention: 'paid',
    since: (order) => order.placedAt,
    notice: (n) => (n === 1 ? '1 order is waiting for your acceptance' : `${n} orders are waiting for your acceptance`),
    noticeHint: 'The franchise has already paid. Open an order to check it against your stock and accept it.',
    sections: [
      { value: 'attention', label: 'Waiting for acceptance', statuses: ['paid'] },
      { value: 'progress', label: 'In progress', statuses: ['accepted', 'packed', 'ready_to_ship', 'shipped'] },
      { value: 'closed', label: 'Completed', statuses: DONE },
    ],
    empty: 'No franchise has ordered from your kitchen yet.',
    emptyAttention: 'Nothing is waiting for acceptance.',
  },
  kitchen_executive: {
    intro:
      'Franchise orders your purchase manager has accepted. Pack each one, print its label for the box, and mark it packed.',
    attention: 'accepted',
    since: (order) => order.acceptedAt,
    notice: (n) => (n === 1 ? '1 franchise order is ready to pack' : `${n} franchise orders are ready to pack`),
    noticeHint: 'The stock has already been taken out for it. Open an order to see what goes in the box.',
    sections: [
      { value: 'attention', label: 'To pack', statuses: ['accepted'] },
      { value: 'progress', label: 'Packed', statuses: ['packed', 'ready_to_ship', 'shipped'] },
      { value: 'closed', label: 'Completed', statuses: DONE },
    ],
    empty: 'No franchise order has been accepted for your kitchen yet.',
    emptyAttention: 'Nothing is waiting to be packed.',
  },
}
const COLUMNS = ['Order', 'Paid on', 'Franchise · Outlet', 'Supplies', 'Order value', 'Status']

const TONE_CLASS = {
  attention: 'bg-accent/20 text-accent border-accent/60',
  progress: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
  done: 'bg-green-500/15 text-green-500 border-green-500/40',
  muted: 'bg-muted/40 text-muted-foreground border-border',
}

// An instant, not a business day, so it is shown in the reader's own time.
const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—'

// "40 min", "5 h", "2 days": how long an order has been waiting.
const waitingFor = (since) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / (24 * 60))} days`
}

// The pill is tinted for attention only on the status this reader acts on: an
// accepted order is the kitchen executive's to do, and plain progress to the
// purchase manager.
const StatusPill = ({ status, attention }) => {
  const meta = ORDER_STATUS[status] || { label: status }
  const tone = status === attention ? 'attention' : meta.tone || 'muted'
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {meta.label}
    </span>
  )
}

const FranchiseOrders = ({ role = 'purchase_manager', shell: shellProp }) => {
  const outletShell = useOutletContext()?.franchiseOrders
  const shell = shellProp || outletShell
  const view = VIEWS[role]
  const toast = useToast()
  const confirm = useConfirm()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needsPass, setNeedsPass] = useState(false)
  const [filter, setFilter] = useState('all')
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')
  // 'accept' | 'pack' | 'print' | 'download' while that is under way.
  const [busy, setBusy] = useState(null)

  useBodyScrollLock(openId !== null)

  const load = useCallback(async () => {
    try {
      const list = await fofoStaffApi.listOrders()
      setOrders(list)
      setNeedsPass(false)
      setError('')
    } catch (err) {
      if (err instanceof StaffPassRequired) setNeedsPass(true)
      else setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // On mount, and again whenever the dashboard's poll sees a count move.
  const shellCount = `${shell?.waiting}/${shell?.toPack}`
  useEffect(() => {
    const timer = setTimeout(load, 0)
    return () => clearTimeout(timer)
  }, [load, shellCount])

  const askForKey = () => {
    setOpenId(null)
    setDetail(null)
    setNeedsPass(true)
  }

  const openOrder = async (id) => {
    setOpenId(id)
    setDetail(null)
    setDetailError('')
    try {
      setDetail(await fofoStaffApi.getOrder(id))
    } catch (err) {
      if (err instanceof StaffPassRequired) askForKey()
      else setDetailError(err.message)
    }
  }

  const closeOrder = () => {
    if (busy === 'accept' || busy === 'pack') return
    setOpenId(null)
    setDetail(null)
  }

  // Accept and pack have the same shape: confirm, ask the server, show the
  // order as it came back, and tell the dashboard its count has moved.
  const change = async (order, { action, call, ask, done, failed }) => {
    if (!(await confirm(ask))) return
    setBusy(action)
    try {
      setDetail(await call(order.id))
      toast.success(...done)
    } catch (err) {
      if (err instanceof StaffPassRequired) {
        askForKey()
      } else {
        // The server's words: which lines are short, or that someone else got there first.
        toast.error(failed, err.message)
        // Stock or status has moved since this was opened; show it as it is now.
        fofoStaffApi.getOrder(order.id).then(setDetail).catch(() => {})
      }
    } finally {
      setBusy(null)
      load()
      shell?.refresh()
    }
  }

  const acceptOrder = (order) =>
    change(order, {
      action: 'accept',
      call: fofoStaffApi.acceptOrder,
      ask: {
        title: `Accept order ${order.orderNumber}?`,
        message: `${order.lines.length === 1 ? 'Its 1 item leaves' : `All ${order.lines.length} items leave`} your kitchen's stock now, at the quantities ordered, and the order goes on to be packed. This cannot be undone from here.`,
        confirmLabel: 'Accept order',
      },
      done: [`Order ${order.orderNumber} accepted`, 'The stock has left your inventory. The order is ready to be packed.'],
      failed: `Order ${order.orderNumber} was not accepted`,
    })

  const packOrder = (order) =>
    change(order, {
      action: 'pack',
      call: fofoStaffApi.packOrder,
      ask: {
        title: `Mark order ${order.orderNumber} as packed?`,
        message: 'Do this once everything on the order is boxed and labelled. Your purchase manager is told it is ready. This cannot be undone from here.',
        confirmLabel: 'Mark as packed',
      },
      done: [`Order ${order.orderNumber} marked as packed`, 'Let your purchase manager know it is ready to go.'],
      failed: `Order ${order.orderNumber} was not marked as packed`,
    })

  // Print opens the browser's print dialog; download saves the same PDF.
  const label = async (order, how) => {
    setBusy(how)
    try {
      const data = await fofoStaffApi.getLabel(order.id)
      const doc = buildShippingLabelPdf(data, { jsPDF })
      if (how === 'print') printPdf(doc)
      else doc.save(shippingLabelFileName(data))
    } catch (err) {
      if (err instanceof StaffPassRequired) askForKey()
      else toast.error(`The label for order ${order.orderNumber} could not be made`, err.message)
    } finally {
      setBusy(null)
    }
  }

  const filters = useMemo(() => [{ value: 'all', label: 'All', statuses: null }, ...view.sections], [view])
  const counts = useMemo(
    () => Object.fromEntries(filters.map((f) => [f.value, orders.filter((o) => !f.statuses || f.statuses.includes(o.status)).length])),
    [filters, orders]
  )
  // The list is always grouped into the view's sections, in order. "All" shows
  // every section that has orders, one under another, each under a ruled
  // heading; choosing a filter shows that section alone.
  const sections = useMemo(
    () =>
      view.sections
        .filter((section) => filter === 'all' || filter === section.value)
        .map((section) => ({ ...section, orders: orders.filter((o) => section.statuses.includes(o.status)) }))
        .filter((section) => section.orders.length > 0),
    [view, orders, filter]
  )
  const needingMe = counts.attention

  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Franchise Orders</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{view.intro}</p>
        </div>

        {needsPass ? (
          <StaffPassPrompt
            onIssued={() => {
              setLoading(true)
              load()
              shell?.refresh()
            }}
          />
        ) : (
          <>
            {needingMe > 0 && (
              <div role="status" className="mb-4 flex items-start gap-3 bg-accent/15 border-2 border-accent rounded-2xl px-4 py-4">
                <span className="relative flex h-3 w-3 mt-1.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-accent" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-foreground">{view.notice(needingMe)}</p>
                  <p className="text-sm text-muted-foreground">{view.noticeHint}</p>
                </div>
                {filter !== 'attention' && (
                  <button
                    type="button"
                    onClick={() => setFilter('attention')}
                    className="px-3 py-2 text-sm font-bold rounded-lg bg-accent text-background hover:bg-accent/90 transition-colors whitespace-nowrap"
                  >
                    Show them
                  </button>
                )}
              </div>
            )}

            <div className="bg-card border border-border rounded-2xl p-4 mb-4 flex flex-wrap gap-2">
              {filters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={filter === option.value}
                  className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                    filter === option.value
                      ? 'bg-accent/15 text-accent border-accent/60'
                      : 'bg-muted/30 text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {option.label} · {counts[option.value]}
                </button>
              ))}
            </div>

            {error && (
              <div className="mb-4 bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground flex items-center justify-between gap-3">
                <span>{error}</span>
                <button type="button" onClick={load} className="font-semibold underline whitespace-nowrap">
                  Try again
                </button>
              </div>
            )}

            <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading franchise orders…</div>
              ) : sections.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {orders.length === 0 ? view.empty : filter === 'attention' ? view.emptyAttention : 'No orders here.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem]">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        {COLUMNS.map((heading) => (
                          <th key={heading} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((section) => (
                        <Fragment key={section.value}>
                          {/* A ruled heading per section, only when more than one kind is listed */}
                          {filter === 'all' && (
                            <tr className="border-y-2 border-border bg-muted/20">
                              <th
                                colSpan={COLUMNS.length}
                                scope="colgroup"
                                className="px-4 py-2.5 text-left text-sm font-bold text-foreground"
                              >
                                {section.label}
                                <span className="ml-2 font-semibold text-muted-foreground">{section.orders.length}</span>
                              </th>
                            </tr>
                          )}
                          {section.orders.map((order) => {
                            const mine = order.status === view.attention
                            return (
                              <tr
                                key={order.id}
                                onClick={() => openOrder(order.id)}
                                className={`border-b border-border/60 last:border-0 cursor-pointer hover:bg-accent/5 transition-colors ${
                                  mine ? 'bg-accent/5' : ''
                                }`}
                              >
                                <td className="px-4 py-3 text-sm">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openOrder(order.id)
                                    }}
                                    className="font-bold text-foreground hover:text-accent transition-colors"
                                  >
                                    {order.orderNumber}
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                                  {when(order.placedAt)}
                                  {mine && view.since(order) && (
                                    <span className="block text-xs text-accent font-semibold">waiting {waitingFor(view.since(order))}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  <span className="block font-semibold text-foreground">{order.franchiseName}</span>
                                  <span className="block text-xs text-muted-foreground">
                                    {order.outlet.name} · {order.outlet.code}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-muted-foreground max-w-[18rem]">
                                  <span className="block text-foreground">
                                    {order.lineCount} {order.lineCount === 1 ? 'item' : 'items'}
                                  </span>
                                  <span className="block text-xs truncate">{order.supplyNames.join(', ')}</span>
                                </td>
                                <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">{moneyExact(order.grandTotal)}</td>
                                <td className="px-4 py-3 text-sm">
                                  <StatusPill status={order.status} attention={view.attention} />
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {openId !== null && (
          <div
            className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4 bg-black/60 backdrop-blur-sm"
            onClick={closeOrder}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Franchise order"
              onClick={(e) => e.stopPropagation()}
              className="bg-card/95 backdrop-blur-md border-2 border-border rounded-t-2xl lg:rounded-2xl shadow-2xl shadow-black/50 w-full max-w-3xl max-h-[92vh] overflow-y-auto"
            >
              <div className="p-5 lg:p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl lg:text-2xl font-bold text-foreground">
                      {detail ? `Order ${detail.orderNumber}` : 'Order'}
                    </h2>
                    {detail && (
                      <p className="text-xs text-muted-foreground">
                        Paid {when(detail.placedAt)} · {moneyExact(detail.grandTotal)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={closeOrder}
                    disabled={busy === 'accept' || busy === 'pack'}
                    aria-label="Close"
                    className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {detailError ? (
                  <div className="bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
                    {detailError}
                  </div>
                ) : !detail ? (
                  <div className="p-8 text-center text-muted-foreground">Loading order…</div>
                ) : (
                  <OrderDetail
                    order={detail}
                    role={role}
                    attention={view.attention}
                    busy={busy}
                    onAccept={() => acceptOrder(detail)}
                    onPack={() => packOrder(detail)}
                    onLabel={(how) => label(detail, how)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const Field = ({ label, children }) => (
  <div>
    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children || '—'}</dd>
  </div>
)

const primaryButton =
  'px-5 py-2.5 text-sm font-bold rounded-xl bg-accent text-background hover:bg-accent/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
const secondaryButton =
  'px-4 py-2.5 text-sm font-semibold rounded-xl border border-border bg-input text-foreground hover:bg-accent/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'

const OrderDetail = ({ order, role, attention, busy, onAccept, onPack, onLabel }) => {
  // Stock on hand comes only with an order still waiting to be accepted, which
  // only a purchase manager is ever sent.
  const awaiting = order.status === 'paid'
  const canAccept = role === 'purchase_manager' && awaiting
  const canPack = role === 'kitchen_executive' && order.status === 'accepted'
  const hasLabel = LABEL_STATUSES.includes(order.status)
  const mine = order.status === attention
  const short = order.lines.filter((line) => line.shortBy > 0)
  const steps = [
    ['Paid', order.timeline.placedAt],
    ['Accepted', order.timeline.acceptedAt, order.timeline.acceptedBy],
    ['Packed', order.timeline.packedAt, order.timeline.packedBy],
    ['Ready to ship', order.timeline.readyAt],
    ['Shipped', order.timeline.shippedAt],
    ['Delivered', order.timeline.deliveredAt],
  ].filter(([, at]) => at)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={order.status} attention={attention} />
        {mine && (
          <span className="text-xs text-accent font-semibold">
            waiting {waitingFor(awaiting ? order.placedAt : order.acceptedAt)}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Franchise">{order.franchise.name}</Field>
        <Field label="Outlet">
          {order.outlet.name} · {order.outlet.code}
        </Field>
        <Field label="Contact">
          {[order.franchise.contactPerson, order.franchise.contactPhone].filter(Boolean).join(' · ')}
        </Field>
        <Field label="Address">{[order.franchise.address, order.franchise.city].filter(Boolean).join(', ')}</Field>
      </dl>

      {awaiting && short.length > 0 && (
        <div role="alert" className="bg-destructive/15 border border-destructive rounded-xl px-4 py-3 text-sm text-destructive-foreground">
          <p className="font-bold">
            Your kitchen is short on {short.length} of {order.lines.length} {order.lines.length === 1 ? 'item' : 'items'}.
          </p>
          <p>
            An order can only be accepted in full. Stock in the shortfall, then accept. Accepting less than was
            ordered is not available yet.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">Supply</th>
              <th className="px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-muted-foreground">Ordered</th>
              <th className="px-4 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {awaiting ? 'In stock now' : canPack ? 'To pack' : 'Accepted'}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="block font-semibold text-foreground">{line.name}</span>
                  <span className="block text-xs text-muted-foreground">{line.code}</span>
                </td>
                <td className="px-4 py-2.5 text-right text-foreground whitespace-nowrap">
                  {quantity(line.quantityOrdered)} {line.unit}
                </td>
                {awaiting ? (
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <span className={line.shortBy > 0 ? 'text-destructive font-bold' : 'text-foreground'}>
                      {quantity(line.onHand)} {line.unit}
                    </span>
                    {line.shortBy > 0 && (
                      <span className="block text-xs text-destructive">
                        short by {quantity(line.shortBy)} {line.unit}
                      </span>
                    )}
                  </td>
                ) : (
                  <td className={`px-4 py-2.5 text-right whitespace-nowrap ${canPack ? 'text-foreground font-bold' : 'text-foreground'}`}>
                    {line.quantityAccepted === null ? '—' : `${quantity(line.quantityAccepted)} ${line.unit}`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {awaiting && (
        <p className="text-xs text-muted-foreground">
          Stock is what your kitchen held when this was opened. It can change before the order is accepted.
        </p>
      )}

      {(canAccept || canPack || hasLabel) && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-border">
          <p className="flex-1 text-sm text-muted-foreground">
            {canAccept
              ? short.length > 0
                ? 'Accept is off until your kitchen holds everything on this order.'
                : 'Accepting takes every item out of your stock at the quantity ordered.'
              : canPack
                ? 'Pack what the “To pack” column says, stick the label on the box, then mark it packed.'
                : 'The label can be printed again at any time until the order is delivered.'}
          </p>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {hasLabel && (
              <>
                <button type="button" onClick={() => onLabel('download')} disabled={busy !== null} className={secondaryButton}>
                  {busy === 'download' ? 'Preparing…' : 'Download label'}
                </button>
                <button
                  type="button"
                  onClick={() => onLabel('print')}
                  disabled={busy !== null}
                  className={canPack || canAccept ? secondaryButton : primaryButton}
                >
                  {busy === 'print' ? 'Preparing…' : 'Print label'}
                </button>
              </>
            )}
            {canAccept && (
              <button type="button" onClick={onAccept} disabled={busy !== null || short.length > 0} className={primaryButton}>
                {busy === 'accept' ? 'Accepting…' : 'Accept order in full'}
              </button>
            )}
            {canPack && (
              <button type="button" onClick={onPack} disabled={busy !== null} className={primaryButton}>
                {busy === 'pack' ? 'Saving…' : 'Mark as packed'}
              </button>
            )}
          </div>
        </div>
      )}

      {steps.length > 1 && (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {steps.map(([label, at, by]) => (
            <Field key={label} label={label}>
              {when(at)}
              {by ? ` · ${by}` : ''}
            </Field>
          ))}
        </dl>
      )}

      {(order.shipping.carrier || order.shipping.trackingRef || order.shipping.notes) && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Carrier">{order.shipping.carrier}</Field>
          <Field label="Tracking">{order.shipping.trackingRef}</Field>
          <Field label="Shipping notes">{order.shipping.notes}</Field>
        </dl>
      )}
    </div>
  )
}

export default FranchiseOrders

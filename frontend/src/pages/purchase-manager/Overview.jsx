import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const Overview = () => {
  const [stats, setStats] = useState({
    totalMaterials: 0,
    stockInThisMonth: 0,
    lowStockItems: 0,
    totalValue: 0,
    stockOutToday: 0,
    pendingAllocationsToday: 0,
    outletsCount: 0,
    supervisorsCount: 0
  })
  const [recentStockIn, setRecentStockIn] = useState([])
  const [recentAllocations, setRecentAllocations] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [showSupervisorsModal, setShowSupervisorsModal] = useState(false)
  const [stockInDetails, setStockInDetails] = useState(null)
  const [showStockInDetailsModal, setShowStockInDetailsModal] = useState(false)
  const [stockOutDetails, setStockOutDetails] = useState(null)
  const [showStockOutDetailsModal, setShowStockOutDetailsModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchOverviewData()
  }, [])

  const fetchOverviewData = async () => {
    const session = getSession()
    if (!session?.cloud_kitchen_id) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)

      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]
      const firstOfMonthStr = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .split('T')[0]

      // Fetch all data in parallel
      const [
        inventoryResult,
        stockInResult,
        stockOutResult,
        batchesResult,
        pendingAllocationsResult,
        outletsResult,
        supervisorsResult
      ] = await Promise.all([
        // Inventory data with raw material details (for low stock and total materials count)
        supabase
          .from('inventory')
          .select(`
            quantity,
            raw_material_id,
            raw_materials!inner (
              id,
              low_stock_threshold
            )
          `)
          .eq('cloud_kitchen_id', session.cloud_kitchen_id),
        
        // Stock In for this month (recent records)
        supabase
          .from('stock_in')
          .select('id, receipt_date, total_cost, supplier_name, invoice_number, stock_in_type')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .gte('receipt_date', firstOfMonthStr)
          .order('receipt_date', { ascending: false })
          .limit(5),
        
        // Recent stock out / allocations to outlets (including self stock out)
        supabase
          .from('stock_out')
          .select(`
            id,
            allocation_date,
            created_at,
            outlet_id,
            self_stock_out,
            reason,
            outlets (
              name,
              code
            )
          `)
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .order('allocation_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5),

        // Stock-in batches for FIFO-based valuation
        supabase
          .from('stock_in_batches')
          .select('quantity_remaining, unit_cost')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .gt('quantity_remaining', 0),

        // Pending allocation requests for today
        supabase
          .from('allocation_requests')
          .select('id')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('request_date', todayStr)
          .eq('is_packed', false),

        // Outlets for this cloud kitchen (for count)
        supabase
          .from('outlets')
          .select('id')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('is_active', true)
          .is('deleted_at', null),

        // Supervisors for this cloud kitchen (for count and modal)
        supabase
          .from('users')
          .select('id, full_name, login_key, phone_number')
          .eq('role', 'supervisor')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .eq('is_active', true)
          .is('deleted_at', null)
      ])

      // Calculate total materials (unique materials in inventory)
      const totalMaterials = inventoryResult.data ? new Set(inventoryResult.data.map(item => item.raw_material_id)).size : 0

      // Calculate low stock items from inventory (using raw_materials.low_stock_threshold)
      // Includes both low-stock (> 0 and <= threshold) and no-stock (quantity === 0) items
      let lowStockItems = 0
      if (inventoryResult.data) {
        inventoryResult.data.forEach(item => {
          const quantity = parseFloat(item.quantity) || 0
          const threshold = parseFloat(item.raw_materials?.low_stock_threshold || 0)
          
          if (quantity === 0) {
            lowStockItems++
          } else if (quantity > 0 && quantity <= threshold) {
            lowStockItems++
          }
        })
      }

      // Total inventory value using FIFO batches (sum of quantity_remaining * unit_cost)
      let totalValue = 0
      if (batchesResult.data) {
        batchesResult.data.forEach(batch => {
          const qty = parseFloat(batch.quantity_remaining) || 0
          const cost = parseFloat(batch.unit_cost) || 0
          totalValue += qty * cost
        })
      }

      // Calculate stock in this month (count of records)
      const stockInThisMonth = stockInResult.data?.length || 0

      // Stock out today (count of stock_out records for today)
      const stockOutToday =
        stockOutResult.data?.filter(record => record.allocation_date === todayStr).length || 0

      // Pending allocation requests for today
      const pendingAllocationsToday = pendingAllocationsResult.data?.length || 0

      const outletsCount = outletsResult.data?.length || 0
      const supervisorsCount = supervisorsResult.data?.length || 0

      setStats({
        totalMaterials,
        stockInThisMonth,
        lowStockItems,
        totalValue,
        stockOutToday,
        pendingAllocationsToday,
        outletsCount,
        supervisorsCount
      })

      setRecentStockIn(stockInResult.data || [])
      setRecentAllocations(stockOutResult.data || [])
      setSupervisors(supervisorsResult.data || [])
    } catch (err) {
      console.error('Error fetching overview data:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount)
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Loading overview...</p>
          </div>
        </div>
      </div>
    )
  }

  const openStockInDetails = async (id) => {
    try {
      setStockInDetails(null)
      setShowStockInDetailsModal(true)

      const { data, error } = await supabase
        .from('stock_in')
        .select(`
          *,
          stock_in_batches (
            id,
            quantity_purchased,
            quantity_remaining,
            unit_cost,
            raw_materials:raw_material_id (
              id,
              name,
              code,
              unit
            )
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      setStockInDetails(data)
    } catch (err) {
      console.error('Error fetching stock in details:', err)
      setShowStockInDetailsModal(false)
    }
  }

  const openStockOutDetails = async (id) => {
    try {
      setStockOutDetails(null)
      setShowStockOutDetailsModal(true)

      const { data, error } = await supabase
        .from('stock_out')
        .select(`
          *,
          outlets (
            name,
            code
          ),
          users:allocated_by (
            id,
            full_name
          ),
          stock_out_items (
            id,
            quantity,
            raw_materials:raw_material_id (
              id,
              name,
              code,
              unit
            )
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      setStockOutDetails(data)
    } catch (err) {
      console.error('Error fetching stock out details:', err)
      setShowStockOutDetailsModal(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">Overview</h1>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Total Materials</p>
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.totalMaterials}</p>
            <button
onClick={() => navigate('/invmanagement/dashboard/purchase_manager/materials')}
            className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View all →
            </button>
          </div>
          
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Stock In (This Month)</p>
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.stockInThisMonth}</p>
            <button
              onClick={() => navigate('/invmanagement/dashboard/purchase_manager/stock-in')}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View records →
            </button>
          </div>
          
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Low Stock Items</p>
              <svg className="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.lowStockItems}</p>
            <button
              onClick={() => navigate('/invmanagement/dashboard/purchase_manager/inventory?filter=low')}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View items →
            </button>
          </div>
          
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Total Inventory Value</p>
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{formatCurrency(stats.totalValue)}</p>
            <button
              onClick={() => navigate('/invmanagement/dashboard/purchase_manager/inventory')}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View inventory →
            </button>
          </div>
        </div>

        {/* Additional Analytics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          {/* Stock Out Today */}
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Stock Out (Today)</p>
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18v-6m0 0V6m0 6h6m-6 0H6" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.stockOutToday}</p>
            <button
              onClick={() => navigate('/invmanagement/dashboard/purchase_manager/stock-out')}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View stock out →
            </button>
          </div>

          {/* Pending Requests Today */}
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Pending Requests (Today)</p>
              <svg className="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.pendingAllocationsToday}</p>
            <button
              onClick={() => navigate('/invmanagement/dashboard/purchase_manager/stock-out')}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View requests →
            </button>
          </div>

          {/* Outlets Count */}
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Outlets</p>
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M5 11h14M7 15h10M9 19h6" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.outletsCount}</p>
            <button
              onClick={() => navigate('/invmanagement/dashboard/purchase_manager/outlets')}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View outlets →
            </button>
          </div>

          {/* Supervisors Count */}
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground font-semibold">Supervisors</p>
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m3-3l2 2 4-4M7 10h6m-6 4h3" />
              </svg>
            </div>
            <p className="text-3xl font-bold text-foreground mt-2">{stats.supervisorsCount}</p>
            <button
              onClick={() => setShowSupervisorsModal(true)}
              className="text-xs text-accent hover:text-accent/80 font-semibold mt-2 touch-manipulation"
            >
              View supervisors →
            </button>
          </div>
        </div>

        {/* Recent Activity Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Stock In */}
          <div className="bg-card border-2 border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Recent Stock In</h2>
              <button
                onClick={() => navigate('/invmanagement/dashboard/purchase_manager/stock-in')}
                className="text-sm text-accent hover:text-accent/80 font-semibold touch-manipulation"
              >
                View all →
              </button>
            </div>
            {recentStockIn.length === 0 ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-muted-foreground mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-muted-foreground">No stock in records this month</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentStockIn.map((record) => {
                  const isKitchen = record.stock_in_type === 'kitchen'
                  return (
                    <div
                      key={record.id}
                      className="bg-background border border-border rounded-lg p-4 hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => openStockInDetails(record.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground flex items-center gap-1">
                            {isKitchen ? (
                              <span>Kitchen Stock In</span>
                            ) : (
                              <>
                                <span>{record.supplier_name || '—'}</span>
                                {record.invoice_number && (
                                  <>
                                    <span className="text-xs text-muted-foreground">•</span>
                                    <span className="text-xs font-mono text-muted-foreground">
                                      {record.invoice_number}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {record.total_cost && (
                              <>
                                <span className="font-semibold">Total:</span>{' '}
                                <span>{formatCurrency(record.total_cost)}</span>
                                <span className="mx-1">•</span>
                              </>
                            )}
                            <span>{formatDate(record.receipt_date)}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${
                              isKitchen
                                ? 'bg-purple-500/15 text-purple-500'
                                : 'bg-accent/20 text-accent'
                            }`}
                          >
                            {isKitchen ? 'Kitchen Stock In' : 'Purchase Stock In'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Allocations */}
          <div className="bg-card border-2 border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Recent Allocations</h2>
              <button
                onClick={() => navigate('/invmanagement/dashboard/purchase_manager/outlets')}
                className="text-sm text-accent hover:text-accent/80 font-semibold touch-manipulation"
              >
                View all →
              </button>
            </div>
            {recentAllocations.length === 0 ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-muted-foreground mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm text-muted-foreground">No recent allocations</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentAllocations.map((allocation) => (
                  <div
                    key={allocation.id}
                    className="bg-background border border-border rounded-lg p-4 hover:bg-accent/5 transition-colors cursor-pointer"
                    onClick={() => openStockOutDetails(allocation.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {allocation.self_stock_out
                            ? 'Self Stock Out'
                            : (allocation.outlets?.name || 'Unknown Outlet')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {allocation.self_stock_out
                            ? `${formatDate(allocation.allocation_date)}${allocation.reason ? ` • ${allocation.reason}` : ''}`
                            : `${allocation.outlets?.code || ''} • ${formatDate(allocation.created_at)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        {allocation.self_stock_out ? (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-purple-500/20 text-purple-500">
                            Self Stock Out
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-green-500/20 text-green-500">
                            Allocated
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stock In Details Modal */}
      {showStockInDetailsModal && stockInDetails && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-foreground">
                {stockInDetails.stock_in_type === 'kitchen'
                  ? 'Kitchen Stock In Details'
                  : 'Purchase Slip Details'}
              </h2>
              <button
                onClick={() => setShowStockInDetailsModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-6 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Receipt Date</p>
                  <p className="font-semibold text-foreground">
                    {new Date(stockInDetails.receipt_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created At</p>
                  <p className="font-semibold text-foreground">
                    {new Date(stockInDetails.created_at).toLocaleString()}
                  </p>
                </div>
                {stockInDetails.supplier_name && (
                  <div>
                    <p className="text-sm text-muted-foreground">Supplier</p>
                    <p className="font-semibold text-foreground">{stockInDetails.supplier_name}</p>
                  </div>
                )}
                {stockInDetails.invoice_number && (
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Number</p>
                    <p className="font-semibold text-foreground font-mono">{stockInDetails.invoice_number}</p>
                  </div>
                )}
              </div>
              {stockInDetails.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <p className="font-semibold text-foreground">{stockInDetails.notes}</p>
                </div>
              )}
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-bold text-foreground mb-3">
                Items ({stockInDetails.stock_in_batches?.length || 0})
              </h3>
              {stockInDetails.stock_in_batches && stockInDetails.stock_in_batches.length > 0 ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Code</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity Purchased</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity Remaining</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Unit Cost</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockInDetails.stock_in_batches.map((batch) => (
                        <tr key={batch.id} className="border-b border-border">
                          <td className="px-4 py-3 text-sm text-foreground">
                            {batch.raw_materials?.name || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {batch.raw_materials?.code || '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {parseFloat(batch.quantity_purchased || 0).toFixed(3)} {batch.raw_materials?.unit || ''}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {parseFloat(batch.quantity_remaining || 0).toFixed(3)} {batch.raw_materials?.unit || ''}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            ₹{parseFloat(batch.unit_cost || 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            ₹{(parseFloat(batch.unit_cost || 0) * parseFloat(batch.quantity_purchased || 0)).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No items found for this purchase slip.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stock Out Details Modal */}
      {showStockOutDetailsModal && stockOutDetails && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-foreground">
                {stockOutDetails.self_stock_out ? 'Self Stock Out Details' : 'Stock Out Details'}
              </h2>
              <button
                onClick={() => setShowStockOutDetailsModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-6 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Allocation Date</p>
                  <p className="font-semibold text-foreground">
                    {new Date(stockOutDetails.allocation_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created At</p>
                  <p className="font-semibold text-foreground">
                    {new Date(stockOutDetails.created_at).toLocaleString()}
                  </p>
                </div>
                {!stockOutDetails.self_stock_out && (
                  <div>
                    <p className="text-sm text-muted-foreground">Outlet</p>
                    <p className="font-semibold text-foreground">
                      {stockOutDetails.outlets?.name || 'N/A'}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {stockOutDetails.outlets?.code || ''}
                    </p>
                  </div>
                )}
                {stockOutDetails.users?.full_name && (
                  <div>
                    <p className="text-sm text-muted-foreground">Allocated By</p>
                    <p className="font-semibold text-foreground">{stockOutDetails.users.full_name}</p>
                  </div>
                )}
              </div>
              {stockOutDetails.self_stock_out && stockOutDetails.reason && (
                <div>
                  <p className="text-sm text-muted-foreground">Reason</p>
                  <p className="font-semibold text-foreground">{stockOutDetails.reason}</p>
                </div>
              )}
              {stockOutDetails.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <p className="font-semibold text-foreground">{stockOutDetails.notes}</p>
                </div>
              )}
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-bold text-foreground mb-3">
                Items ({stockOutDetails.stock_out_items?.length || 0})
              </h3>
              {stockOutDetails.stock_out_items && stockOutDetails.stock_out_items.length > 0 ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Material</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Code</th>
                        <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockOutDetails.stock_out_items.map((item) => (
                        <tr key={item.id} className="border-b border-border">
                          <td className="px-4 py-3 text-sm text-foreground">
                            {item.raw_materials?.name || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {item.raw_materials?.code || '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {parseFloat(item.quantity || 0).toFixed(3)} {item.raw_materials?.unit || ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No items found for this stock out.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Supervisors Details Modal */}
      {showSupervisorsModal && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-foreground">Supervisors</h2>
              <button
                onClick={() => setShowSupervisorsModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {supervisors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No supervisors found for this cloud kitchen.</p>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-background border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Full Name</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Login Key</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-foreground">Phone Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supervisors.map((sup) => (
                      <tr key={sup.id} className="border-b border-border">
                        <td className="px-4 py-3 text-sm text-foreground">
                          {sup.full_name}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                          {sup.login_key || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {sup.phone_number || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Overview

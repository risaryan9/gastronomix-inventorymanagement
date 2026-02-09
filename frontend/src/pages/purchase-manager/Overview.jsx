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
    pendingAllocationsToday: 0
  })
  const [recentStockIn, setRecentStockIn] = useState([])
  const [recentAllocations, setRecentAllocations] = useState([])
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
        pendingAllocationsResult
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
          .select('id, receipt_date, total_cost')
          .eq('cloud_kitchen_id', session.cloud_kitchen_id)
          .gte('receipt_date', firstOfMonthStr)
          .order('receipt_date', { ascending: false })
          .limit(5),
        
        // Recent stock out / allocations to outlets
        supabase
          .from('stock_out')
          .select(`
            id,
            allocation_date,
            created_at,
            outlet_id,
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
          .eq('is_packed', false)
      ])

      // Calculate total materials (unique materials in inventory)
      const totalMaterials = inventoryResult.data ? new Set(inventoryResult.data.map(item => item.raw_material_id)).size : 0

      // Calculate low stock items from inventory (using raw_materials.low_stock_threshold)
      let lowStockItems = 0
      if (inventoryResult.data) {
        inventoryResult.data.forEach(item => {
          const quantity = parseFloat(item.quantity) || 0
          const threshold = parseFloat(item.raw_materials?.low_stock_threshold || 0)
          
          if (quantity > 0 && quantity <= threshold) {
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

      setStats({
        totalMaterials,
        stockInThisMonth,
        lowStockItems,
        totalValue,
        stockOutToday,
        pendingAllocationsToday
      })

      setRecentStockIn(stockInResult.data || [])
      setRecentAllocations(stockOutResult.data || [])
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
                {recentStockIn.map((record) => (
                  <div
                    key={record.id}
                    className="bg-background border border-border rounded-lg p-4 hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {formatDate(record.receipt_date)}
                        </p>
                        {record.total_cost && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Total: {formatCurrency(record.total_cost)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-accent/20 text-accent">
                          Stock In
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
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
                    className="bg-background border border-border rounded-lg p-4 hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {allocation.outlets?.name || 'Unknown Outlet'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {allocation.outlets?.code} • {formatDate(allocation.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-green-500/20 text-green-500">
                          Allocated
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Overview

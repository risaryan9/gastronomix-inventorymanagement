import { useEffect, useState, useMemo } from 'react'
import { fetchReportCloudKitchens, fetchReportOutlets, fetchOutletVarianceCounts, fetchOutletRequisitionReportRows, fetchRequisitionVarianceDetails } from '../../lib/allocationRequests'
import PaginationControls from '../../components/PaginationControls'

const summarizeRequisitionVariance = (requisition) => {
  const requestedMap = new Map()
  requisition.allocation_request_items?.forEach((item) => {
    requestedMap.set(item.raw_material_id, parseFloat(item.quantity))
  })

  const stockOutItems = requisition.stock_out?.[0]?.stock_out_items || []
  const actualMap = new Map()
  stockOutItems.forEach((item) => {
    actualMap.set(item.raw_material_id, parseFloat(item.quantity))
  })

  const allMaterialIds = new Set([...requestedMap.keys(), ...actualMap.keys()])

  let increased = 0
  let decreased = 0
  allMaterialIds.forEach((materialId) => {
    const requested = requestedMap.get(materialId) || 0
    const actual = actualMap.get(materialId) || 0
    if (actual > requested) increased += 1
    else if (actual < requested) decreased += 1
  })

  return { increased, decreased }
}

const AdminRequisitionsReports = () => {
  const [cloudKitchens, setCloudKitchens] = useState([])
  const [selectedCloudKitchenId, setSelectedCloudKitchenId] = useState('')
  const [outlets, setOutlets] = useState([])
  const [varianceCounts, setVarianceCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const [selectedOutlet, setSelectedOutlet] = useState(null)
  const [requisitionsModalOpen, setRequisitionsModalOpen] = useState(false)
  const [requisitions, setRequisitions] = useState([])
  const [requisitionsLoading, setRequisitionsLoading] = useState(false)
  const [requisitionsError, setRequisitionsError] = useState('')
  const [requisitionsSearch, setRequisitionsSearch] = useState('')
  const [requisitionsPage, setRequisitionsPage] = useState(1)
  const requisitionsPageSize = 10

  const [selectedRequisition, setSelectedRequisition] = useState(null)
  const [varianceModalOpen, setVarianceModalOpen] = useState(false)
  const [varianceDetails, setVarianceDetails] = useState(null)
  const [varianceLoading, setVarianceLoading] = useState(false)
  const [varianceError, setVarianceError] = useState('')

  useEffect(() => {
    loadCloudKitchens()
  }, [])

  useEffect(() => {
    loadOutlets(selectedCloudKitchenId)
  }, [selectedCloudKitchenId])

  const loadCloudKitchens = async () => {
    try {
      const data = await fetchReportCloudKitchens()
      setCloudKitchens(data)
    } catch (err) {
      console.error('Error loading cloud kitchens:', err)
    }
  }

  const loadOutlets = async (cloudKitchenId) => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchReportOutlets(cloudKitchenId || null)
      setOutlets(data)
      loadVarianceCounts(data.map((outlet) => outlet.id))
    } catch (err) {
      console.error('Error loading outlets:', err)
      setError('Failed to load outlets. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const loadVarianceCounts = async (outletIds) => {
    try {
      const rows = await fetchOutletVarianceCounts(outletIds)
      const counts = {}
      rows.forEach((req) => {
        const { increased, decreased } = summarizeRequisitionVariance(req)
        if (increased > 0 || decreased > 0) {
          counts[req.outlet_id] = (counts[req.outlet_id] || 0) + 1
        }
      })
      setVarianceCounts(counts)
    } catch (err) {
      console.error('Error loading variance counts:', err)
    }
  }

  const filteredOutlets = useMemo(() => {
    if (!search.trim()) return outlets

    const searchLower = search.toLowerCase()
    return outlets.filter((outlet) => {
      const outletName = outlet.name?.toLowerCase() || ''
      const kitchenName = outlet.cloud_kitchens?.name?.toLowerCase() || ''

      return (
        outletName.includes(searchLower) ||
        kitchenName.includes(searchLower)
      )
    })
  }, [outlets, search])

  const handleOutletClick = async (outlet) => {
    setSelectedOutlet(outlet)
    setRequisitionsModalOpen(true)
    setRequisitionsSearch('')
    setRequisitionsPage(1)
    setRequisitionsError('')
    
    try {
      setRequisitionsLoading(true)
      const data = await fetchOutletRequisitionReportRows(outlet.id)
      setRequisitions(data)
    } catch (err) {
      console.error('Error loading requisitions:', err)
      setRequisitionsError('Failed to load requisitions. Please try again.')
    } finally {
      setRequisitionsLoading(false)
    }
  }

  const closeRequisitionsModal = () => {
    setRequisitionsModalOpen(false)
    setSelectedOutlet(null)
    setRequisitions([])
    setRequisitionsSearch('')
    setRequisitionsPage(1)
  }

  const handleRequisitionClick = async (requisition) => {
    setSelectedRequisition(requisition)
    setVarianceModalOpen(true)
    setVarianceError('')
    
    try {
      setVarianceLoading(true)
      const data = await fetchRequisitionVarianceDetails(requisition.id)
      setVarianceDetails(data)
    } catch (err) {
      console.error('Error loading variance details:', err)
      setVarianceError('Failed to load variance details. Please try again.')
    } finally {
      setVarianceLoading(false)
    }
  }

  const closeVarianceModal = () => {
    setVarianceModalOpen(false)
    setSelectedRequisition(null)
    setVarianceDetails(null)
  }

  const filteredRequisitions = useMemo(() => {
    if (!requisitionsSearch.trim()) return requisitions

    const searchLower = requisitionsSearch.toLowerCase()
    return requisitions.filter((req) => {
      const reqId = req.id?.toLowerCase() || ''
      const reqDate = req.request_date?.toLowerCase() || ''
      const supervisorName = req.supervisor_name?.toLowerCase() || ''
      const notes = req.notes?.toLowerCase() || ''
      
      return (
        reqId.includes(searchLower) ||
        reqDate.includes(searchLower) ||
        supervisorName.includes(searchLower) ||
        notes.includes(searchLower)
      )
    })
  }, [requisitions, requisitionsSearch])

  const paginatedRequisitions = useMemo(() => {
    const startIndex = (requisitionsPage - 1) * requisitionsPageSize
    const endIndex = startIndex + requisitionsPageSize
    return filteredRequisitions.slice(startIndex, endIndex)
  }, [filteredRequisitions, requisitionsPage, requisitionsPageSize])

  const requisitionsTotalPages = Math.ceil(filteredRequisitions.length / requisitionsPageSize)

  useEffect(() => {
    setRequisitionsPage(1)
  }, [requisitionsSearch])

  const varianceRows = useMemo(() => {
    if (!varianceDetails) return []

    const requestedItemsMap = new Map()
    varianceDetails.allocation_request_items?.forEach((item) => {
      requestedItemsMap.set(item.raw_material_id, {
        material: item.raw_materials,
        requested: parseFloat(item.quantity),
      })
    })

    const stockOutItems = varianceDetails.stock_out?.[0]?.stock_out_items || []
    const actualItemsMap = new Map()
    stockOutItems.forEach((item) => {
      actualItemsMap.set(item.raw_material_id, parseFloat(item.quantity))
    })

    const allMaterialIds = new Set([
      ...requestedItemsMap.keys(),
      ...actualItemsMap.keys(),
    ])

    const rows = []
    allMaterialIds.forEach((materialId) => {
      const requestedData = requestedItemsMap.get(materialId)
      const requested = requestedData?.requested || 0
      const actual = actualItemsMap.get(materialId) || 0
      const difference = actual - requested

      rows.push({
        materialId,
        material: requestedData?.material || stockOutItems.find(i => i.raw_material_id === materialId)?.raw_materials,
        requested,
        actual,
        difference,
      })
    })

    return rows.sort((a, b) => a.material?.name?.localeCompare(b.material?.name || '') || 0)
  }, [varianceDetails])

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-xl font-bold text-foreground mb-2">Requisitions Reports</h2>
        <p className="text-sm text-muted-foreground mb-6">
          View and analyze changes made by purchase managers to requisitions. Click on any outlet to see its requisitions, then click on a requisition to view detailed variance.
        </p>

        <div className="mb-4 flex flex-col sm:flex-row gap-3">
          <select
            value={selectedCloudKitchenId}
            onChange={(e) => setSelectedCloudKitchenId(e.target.value)}
            className="sm:w-64 shrink-0 px-4 py-2 border border-border rounded-lg bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">All Cloud Kitchens</option>
            {cloudKitchens.map((kitchen) => (
              <option key={kitchen.id} value={kitchen.id}>
                {kitchen.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search outlets by name or cloud kitchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 border border-border rounded-lg bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading outlets...</div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">{error}</div>
        ) : filteredOutlets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? 'No outlets found matching your search.' : 'No outlets available.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Outlet Name</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Cloud Kitchen</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Variance Requests</th>
                </tr>
              </thead>
              <tbody>
                {filteredOutlets.map((outlet) => {
                  const varianceCount = varianceCounts[outlet.id] || 0
                  const isInactive = !outlet.is_active || !!outlet.deleted_at
                  return (
                    <tr
                      key={outlet.id}
                      onClick={() => handleOutletClick(outlet)}
                      className={`border-b border-border hover:bg-muted/50 cursor-pointer transition-colors ${
                        isInactive ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-foreground font-medium">{outlet.name}</td>
                      <td className="py-3 px-4 text-foreground">{outlet.cloud_kitchens?.name || '-'}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-full text-xs font-semibold ${
                            varianceCount > 0
                              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {varianceCount}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {requisitionsModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-border">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Requisitions for {selectedOutlet?.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Cloud Kitchen: {selectedOutlet?.cloud_kitchens?.name}
                  </p>
                </div>
                <button
                  onClick={closeRequisitionsModal}
                  className="text-muted-foreground hover:text-foreground transition-colors text-2xl font-bold leading-none"
                >
                  ×
                </button>
              </div>
              <div className="mt-4">
                <input
                  type="text"
                  placeholder="Search requisitions by ID, date, supervisor, or notes..."
                  value={requisitionsSearch}
                  onChange={(e) => setRequisitionsSearch(e.target.value)}
                  className="w-full px-4 py-2 border border-border rounded-lg bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {requisitionsLoading ? (
                <div className="text-center py-12 text-muted-foreground">Loading requisitions...</div>
              ) : requisitionsError ? (
                <div className="text-center py-12 text-destructive">{requisitionsError}</div>
              ) : filteredRequisitions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {requisitionsSearch
                    ? 'No requisitions found matching your search.'
                    : 'No requisitions with stock-out records found for this outlet.'}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-3 px-4 font-semibold text-foreground">Request Date</th>
                          <th className="text-left py-3 px-4 font-semibold text-foreground">Supervisor</th>
                          <th className="text-left py-3 px-4 font-semibold text-foreground">Stock Out Date</th>
                          <th className="text-left py-3 px-4 font-semibold text-foreground">Status</th>
                          <th className="text-left py-3 px-4 font-semibold text-foreground">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRequisitions.map((req) => {
                          const variance = summarizeRequisitionVariance(req)
                          const hasVariance = variance.increased > 0 || variance.decreased > 0
                          return (
                            <tr
                              key={req.id}
                              onClick={() => handleRequisitionClick(req)}
                              className="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors"
                            >
                              <td className="py-3 px-4 text-foreground font-medium">
                                {new Date(req.request_date).toLocaleDateString()}
                              </td>
                              <td className="py-3 px-4 text-muted-foreground">
                                {req.supervisor_name || '-'}
                              </td>
                              <td className="py-3 px-4 text-foreground">
                                {req.stock_out?.[0]?.allocation_date
                                  ? new Date(req.stock_out[0].allocation_date).toLocaleDateString()
                                  : '-'}
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                                    req.is_packed
                                      ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                                      : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
                                  }`}
                                >
                                  {req.is_packed ? 'Packed' : 'Pending'}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                {hasVariance ? (
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold">
                                    {variance.increased > 0 && (
                                      <span className="text-green-600 dark:text-green-400">
                                        ▲ {variance.increased}
                                      </span>
                                    )}
                                    {variance.decreased > 0 && (
                                      <span className="text-red-600 dark:text-red-400">
                                        ▼ {variance.decreased}
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-xs font-medium text-muted-foreground">Matched</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {requisitionsTotalPages > 1 && (
                    <div className="mt-4">
                      <PaginationControls
                        currentPage={requisitionsPage}
                        totalPages={requisitionsTotalPages}
                        onPageChange={setRequisitionsPage}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {varianceModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-card border border-border rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-border">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Requisition Variance Details</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Request Date: {varianceDetails?.request_date ? new Date(varianceDetails.request_date).toLocaleDateString() : '-'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Outlet: {varianceDetails?.outlets?.name} | Cloud Kitchen: {varianceDetails?.cloud_kitchens?.name}
                  </p>
                </div>
                <button
                  onClick={closeVarianceModal}
                  className="text-muted-foreground hover:text-foreground transition-colors text-2xl font-bold leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {varianceLoading ? (
                <div className="text-center py-12 text-muted-foreground">Loading variance details...</div>
              ) : varianceError ? (
                <div className="text-center py-12 text-destructive">{varianceError}</div>
              ) : varianceRows.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No items found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-semibold text-foreground">Material</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground">Code</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground">Requested</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground">Stocked Out</th>
                        <th className="text-right py-3 px-4 font-semibold text-foreground">Difference</th>
                        <th className="text-left py-3 px-4 font-semibold text-foreground">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {varianceRows.map((row) => (
                        <tr key={row.materialId} className="border-b border-border">
                          <td className="py-3 px-4 text-foreground font-medium">{row.material?.name || '-'}</td>
                          <td className="py-3 px-4 text-muted-foreground">{row.material?.code || '-'}</td>
                          <td className="py-3 px-4 text-right text-foreground">{row.requested.toFixed(3)}</td>
                          <td className="py-3 px-4 text-right text-foreground">{row.actual.toFixed(3)}</td>
                          <td
                            className={`py-3 px-4 text-right font-semibold ${
                              row.difference > 0
                                ? 'text-green-600 dark:text-green-400'
                                : row.difference < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {row.difference > 0 ? '+' : ''}
                            {row.difference.toFixed(3)}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">{row.material?.unit || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminRequisitionsReports

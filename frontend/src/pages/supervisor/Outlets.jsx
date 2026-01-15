import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import nippuKodiLogo from '../../assets/nippu-kodi-logo.png'
import elChaapoLogo from '../../assets/el-chaapo-logo.png'
import boomPizzaLogo from '../../assets/boom-pizza-logo.png'

const BRANDS = [
  { id: 'NK', name: 'Nippu Kodi', color: 'bg-black', hoverColor: 'hover:bg-gray-900', logo: nippuKodiLogo },
  { id: 'EC', name: 'El Chaapo', color: 'bg-green-500', hoverColor: 'hover:bg-green-600', logo: elChaapoLogo },
  { id: 'BP', name: 'Boom Pizza', color: 'bg-red-500', hoverColor: 'hover:bg-red-600', logo: boomPizzaLogo },
]

const Outlets = () => {
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [outlets, setOutlets] = useState([])
  const [allOutlets, setAllOutlets] = useState([]) // Store all fetched outlets
  const [loading, setLoading] = useState(false)
  const [cloudKitchenId, setCloudKitchenId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [alert, setAlert] = useState(null) // { type: 'error' | 'success' | 'warning', message: string }
  const navigate = useNavigate()

  useEffect(() => {
    const session = getSession()
    if (session?.cloud_kitchen_id) {
      setCloudKitchenId(session.cloud_kitchen_id)
    }
  }, [])

  useEffect(() => {
    if (selectedBrand && cloudKitchenId) {
      fetchOutlets()
    } else {
      setOutlets([])
      setAllOutlets([])
      setSearchTerm('')
    }
  }, [selectedBrand, cloudKitchenId])

  const fetchOutlets = async () => {
    if (!cloudKitchenId || !selectedBrand) return

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('outlets')
        .select('*')
        .eq('cloud_kitchen_id', cloudKitchenId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .ilike('code', `${selectedBrand}%`)
        .order('name', { ascending: true })

      if (error) {
        console.error('Error fetching outlets:', error)
        setAlert({ type: 'error', message: `Error fetching outlets: ${error.message}` })
        return
      }

      const fetchedOutlets = data || []
      setAllOutlets(fetchedOutlets)
      setOutlets(fetchedOutlets)
    } catch (err) {
      console.error('Error:', err)
      setAlert({ type: 'error', message: 'Failed to fetch outlets' })
    } finally {
      setLoading(false)
    }
  }

  // Filter outlets based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setOutlets(allOutlets)
      return
    }

    const filtered = allOutlets.filter(outlet =>
      outlet.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (outlet.address && outlet.address.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    setOutlets(filtered)
  }, [searchTerm, allOutlets])

  const handleOutletClick = (outlet) => {
    navigate(`/invmanagement/dashboard/supervisor/outlets/${outlet.id}`, { state: { outlet } })
  }

  const getBrandColor = (brandId) => {
    return BRANDS.find(b => b.id === brandId)?.color || 'bg-gray-500'
  }

  const getBrandLogo = (brandId) => {
    return BRANDS.find(b => b.id === brandId)?.logo || null
  }

  return (
    <div className="p-3 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-xl lg:text-3xl font-bold text-foreground mb-4 lg:mb-6">Outlets</h1>

        {/* Brand Selection - Mobile First: Horizontal, Smaller */}
        <div className="mb-4 lg:mb-6">
          <h2 className="text-sm lg:text-lg font-semibold text-foreground mb-2 lg:mb-4">Select Brand</h2>
          <div className="flex flex-row lg:grid lg:grid-cols-3 gap-2 lg:gap-4">
            {BRANDS.map((brand) => (
              <button
                key={brand.id}
                onClick={() => {
                  setSelectedBrand(brand.id)
                  setSearchTerm('') // Clear search when brand changes
                }}
                className={`${brand.color} ${brand.hoverColor} text-white font-bold py-2.5 lg:py-8 px-3 lg:px-6 rounded-lg lg:rounded-xl transition-all duration-200 shadow-md lg:shadow-lg hover:shadow-lg lg:hover:shadow-xl transform hover:scale-105 active:scale-95 touch-manipulation flex-1 lg:flex-none ${
                  selectedBrand === brand.id ? 'ring-2 lg:ring-4 ring-white ring-offset-1 lg:ring-offset-2' : ''
                }`}
              >
                <div className="text-center flex flex-col items-center">
                  <img 
                    src={brand.logo} 
                    alt={brand.name} 
                    className="h-6 lg:h-12 w-auto mb-1 lg:mb-2 object-contain"
                  />
                  <div className="text-xs lg:text-2xl font-black mb-0.5 lg:mb-1 truncate">{brand.name}</div>
                  <div className="hidden lg:block text-xs lg:text-sm opacity-90">Tap to view outlets</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Outlets Display */}
        {selectedBrand && (
          <div>
            <div className="flex items-center justify-between mb-3 lg:mb-4">
              <h2 className="text-base lg:text-lg font-semibold text-foreground">
                {BRANDS.find(b => b.id === selectedBrand)?.name} Outlets
              </h2>
              {outlets.length > 0 && (
                <span className="text-xs lg:text-sm text-muted-foreground">
                  {outlets.length} outlet{outlets.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Search Section */}
            <div className="mb-4 lg:mb-6">
              <div className="bg-card border-2 border-border rounded-xl p-3 lg:p-4">
                <label htmlFor="outlet-search" className="block text-sm font-semibold text-foreground mb-2">
                  Search Outlets
                </label>
                <input
                  id="outlet-search"
                  type="text"
                  placeholder="Search by outlet name or address..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg px-4 py-3 lg:py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all text-base"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="mt-2 text-xs text-accent hover:text-accent/80 font-semibold touch-manipulation"
                  >
                    Clear search
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12">
                <div className="text-center">
                  <p className="text-muted-foreground">Loading outlets...</p>
                </div>
              </div>
            ) : outlets.length === 0 ? (
              <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12">
                <div className="text-center">
                  <h3 className="text-lg lg:text-xl font-bold text-foreground mb-2">No Outlets Found</h3>
                  <p className="text-sm lg:text-base text-muted-foreground">
                    {searchTerm
                      ? `No outlets match your search "${searchTerm}"`
                      : `No ${BRANDS.find(b => b.id === selectedBrand)?.name} outlets found for your cloud kitchen.`}
                  </p>
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="mt-4 text-sm text-accent hover:text-accent/80 font-semibold touch-manipulation"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
                {outlets.map((outlet) => (
                  <button
                    key={outlet.id}
                    onClick={() => handleOutletClick(outlet)}
                    className="bg-card border-2 border-border rounded-xl p-4 lg:p-5 hover:border-accent hover:shadow-lg transition-all duration-200 text-left active:scale-98 touch-manipulation"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base lg:text-lg font-bold text-foreground mb-1 truncate">
                          {outlet.name}
                        </h3>
                        <p className="text-xs lg:text-sm text-muted-foreground font-mono">
                          {outlet.code}
                        </p>
                      </div>
                      <div className={`${getBrandColor(selectedBrand)} text-white text-xs font-bold px-2 py-1 rounded-lg ml-2 flex items-center gap-1.5`}>
                        {getBrandLogo(selectedBrand) && (
                          <img 
                            src={getBrandLogo(selectedBrand)} 
                            alt={BRANDS.find(b => b.id === selectedBrand)?.name} 
                            className="h-4 w-auto object-contain"
                          />
                        )}
                        <span>{BRANDS.find(b => b.id === selectedBrand)?.name}</span>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm lg:text-base">
                      <div className="flex items-start">
                        <svg className="w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-muted-foreground">{outlet.address}</span>
                      </div>

                      <div className="flex items-center">
                        <svg className="w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-muted-foreground">{outlet.contact_person}</span>
                      </div>

                      <div className="flex items-center">
                        <svg className="w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <span className="text-muted-foreground">{outlet.contact_phone}</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-xs lg:text-sm text-accent font-semibold">View Details & Allocate</span>
                      <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Initial State - No Brand Selected */}
        {!selectedBrand && (
          <div className="bg-card border-2 border-border rounded-xl p-8 lg:p-12">
            <div className="text-center">
              <svg className="w-16 h-16 lg:w-20 lg:h-20 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <h3 className="text-lg lg:text-xl font-bold text-foreground mb-2">Select a Brand</h3>
              <p className="text-sm lg:text-base text-muted-foreground">
                Choose a brand above to view its outlets
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Custom Alert Modal */}
      {alert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-4">
          <div className="bg-card border-2 border-border rounded-t-2xl lg:rounded-xl p-5 lg:p-6 max-w-md w-full shadow-xl">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className={`flex-shrink-0 w-10 h-10 lg:w-12 lg:h-12 rounded-full flex items-center justify-center ${
                alert.type === 'error' ? 'bg-destructive/20' :
                alert.type === 'success' ? 'bg-green-500/20' :
                'bg-yellow-500/20'
              }`}>
                {alert.type === 'error' ? (
                  <svg className="w-6 h-6 lg:w-7 lg:h-7 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : alert.type === 'success' ? (
                  <svg className="w-6 h-6 lg:w-7 lg:h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 lg:w-7 lg:h-7 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
              </div>

              {/* Message */}
              <div className="flex-1 min-w-0">
                <h3 className={`text-base lg:text-lg font-bold mb-1 ${
                  alert.type === 'error' ? 'text-destructive' :
                  alert.type === 'success' ? 'text-green-500' :
                  'text-yellow-500'
                }`}>
                  {alert.type === 'error' ? 'Error' :
                   alert.type === 'success' ? 'Success' :
                   'Warning'}
                </h3>
                <p className="text-sm lg:text-base text-foreground break-words">
                  {alert.message}
                </p>
              </div>

              {/* Close Button */}
              <button
                onClick={() => setAlert(null)}
                className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Action Button */}
            <div className="mt-4">
              <button
                onClick={() => setAlert(null)}
                className={`w-full font-bold px-4 py-3 rounded-xl transition-all duration-200 text-base touch-manipulation ${
                  alert.type === 'error' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' :
                  alert.type === 'success' ? 'bg-green-500 text-white hover:bg-green-600' :
                  'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Outlets

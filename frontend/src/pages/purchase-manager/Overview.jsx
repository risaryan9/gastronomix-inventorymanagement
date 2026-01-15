const Overview = () => {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">Overview</h1>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <p className="text-sm text-muted-foreground font-semibold">Total Materials</p>
            <p className="text-3xl font-bold text-foreground mt-2">--</p>
          </div>
          
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <p className="text-sm text-muted-foreground font-semibold">Stock In (This Month)</p>
            <p className="text-3xl font-bold text-foreground mt-2">--</p>
          </div>
          
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <p className="text-sm text-muted-foreground font-semibold">Low Stock Items</p>
            <p className="text-3xl font-bold text-foreground mt-2">--</p>
          </div>
          
          <div className="bg-card border-2 border-border rounded-xl p-6 hover:shadow-lg transition-shadow">
            <p className="text-sm text-muted-foreground font-semibold">Total Value</p>
            <p className="text-3xl font-bold text-foreground mt-2">--</p>
          </div>
        </div>

        {/* Content Placeholder */}
        <div className="bg-card border-2 border-border rounded-xl p-8">
          <div className="text-center py-12">
            <h3 className="text-xl font-bold text-foreground mb-2">Overview Dashboard</h3>
            <p className="text-muted-foreground">Detailed analytics and charts will be displayed here.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Overview

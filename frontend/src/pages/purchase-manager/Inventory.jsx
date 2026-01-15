const Inventory = () => {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Inventory</h1>
          <div className="flex gap-2">
            <button className="bg-transparent text-accent font-semibold px-5 py-2.5 rounded-lg border-2 border-accent hover:bg-accent/10 transition-all">
              Export
            </button>
            <button className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200">
              Adjust Stock
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-card border-2 border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground font-semibold mb-1">Total Items</p>
            <p className="text-3xl font-bold text-foreground">--</p>
          </div>
          <div className="bg-card border-2 border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground font-semibold mb-1">Low Stock Alerts</p>
            <p className="text-3xl font-bold text-destructive">--</p>
          </div>
          <div className="bg-card border-2 border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground font-semibold mb-1">Total Value</p>
            <p className="text-3xl font-bold text-foreground">--</p>
          </div>
        </div>
        
        {/* Search and Filter */}
        <div className="bg-card border-2 border-border rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search inventory..."
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
            />
            <select className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all">
              <option>All Stock Levels</option>
              <option>In Stock</option>
              <option>Low Stock</option>
              <option>Out of Stock</option>
            </select>
          </div>
        </div>

        {/* Content Placeholder */}
        <div className="bg-card border-2 border-border rounded-xl p-8">
          <div className="text-center py-16">
            <h3 className="text-xl font-bold text-foreground mb-2">Current Inventory Levels</h3>
            <p className="text-muted-foreground">View and manage stock levels for your cloud kitchen</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Inventory

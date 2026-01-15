const Materials = () => {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Materials</h1>
          <button className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200">
            + Add New Material
          </button>
        </div>
        
        {/* Search and Filter */}
        <div className="bg-card border-2 border-border rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search materials..."
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
            />
            <select className="bg-input border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all">
              <option>All Categories</option>
              <option>Vegetables</option>
              <option>Spices</option>
              <option>Packaging</option>
            </select>
          </div>
        </div>

        {/* Content Placeholder */}
        <div className="bg-card border-2 border-border rounded-xl p-8">
          <div className="text-center py-16">
            <h3 className="text-xl font-bold text-foreground mb-2">Raw Materials Catalog</h3>
            <p className="text-muted-foreground mb-6">Manage your raw materials inventory catalog</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              <div className="bg-background border border-border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Total Materials</p>
                <p className="text-2xl font-bold text-foreground">--</p>
              </div>
              <div className="bg-background border border-border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-foreground">--</p>
              </div>
              <div className="bg-background border border-border rounded-lg p-4">
                <p className="text-sm text-muted-foreground">Categories</p>
                <p className="text-2xl font-bold text-foreground">--</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Materials

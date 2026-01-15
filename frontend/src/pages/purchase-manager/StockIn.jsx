const StockIn = () => {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Stock In</h1>
          <button className="bg-accent text-background font-bold px-6 py-3 rounded-xl border-3 border-accent shadow-button hover:shadow-button-hover hover:translate-x-[-0.05em] hover:translate-y-[-0.05em] transition-all duration-200">
            + Add New Stock In
          </button>
        </div>
        
        {/* Content Placeholder */}
        <div className="bg-card border-2 border-border rounded-xl p-8">
          <div className="text-center py-16">
            <h3 className="text-xl font-bold text-foreground mb-2">Stock In Management</h3>
            <p className="text-muted-foreground mb-6">Record and track incoming stock receipts</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button className="bg-accent text-background font-semibold px-5 py-2.5 rounded-lg hover:brightness-110 transition-all">
                View All Stock In Records
              </button>
              <button className="bg-transparent text-accent font-semibold px-5 py-2.5 rounded-lg border-2 border-accent hover:bg-accent/10 transition-all">
                Export Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StockIn

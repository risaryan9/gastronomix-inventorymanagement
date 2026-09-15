// Labels for what the catalogue and order responses carry. Words only: every
// price, quantity step and status itself comes from /api/franchise.

// Order statuses as the franchise sees them (spec §9), in lifecycle order.
export const ORDER_STATUS = {
  pending_payment: { label: 'Awaiting payment', tone: 'warn' },
  paid: { label: 'Placed', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'info' },
  packed: { label: 'Packed', tone: 'info' },
  ready_to_ship: { label: 'Ready to ship', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
}
export const ORDER_STEPS = ['paid', 'accepted', 'packed', 'ready_to_ship', 'shipped', 'delivered']

export const MATERIAL_TYPE_LABEL = {
  raw_material: 'Raw material',
  semi_finished: 'Semi-finished',
  finished: 'Finished',
  non_food: 'Packaging & non-food',
}

export const BRAND_STYLE = {
  EC: 'bg-accent text-accent-foreground',
  NK: 'bg-destructive text-destructive-foreground',
  BP: 'bg-success text-background',
}
export const brandClass = (brand) => BRAND_STYLE[brand] || 'bg-muted text-foreground'

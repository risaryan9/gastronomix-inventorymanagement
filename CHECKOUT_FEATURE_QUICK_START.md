# Supervisor Checkout Feature - Quick Start Guide

## What is the Checkout Feature?

The Checkout feature allows supervisors to record the return of unused materials from outlets back to the cloud kitchen at the end of a business day. It also tracks wastage and financial information for analytics.

## How to Use

### 1. Access the Checkout Section
- Log in as a Supervisor
- Click on the "Check Out" tab in the navigation bar

### 2. Create a New Checkout

#### Prerequisites:
- A dispatch plan must be "locked" by the Dispatch Executive
- The dispatch plan must have been locked within the last 24 hours
- The checkout can only be created once per dispatch plan

#### Steps:
1. In the "Available Dispatch Plans" section, find the dispatch plan you want to checkout
2. Click the "Create Checkout" button
3. A modal will open with a 3-step form

### 3. Fill Out the Checkout Form

#### Step 1: Return Quantities (1/3)
- You'll see a table with all materials that were dispatched to outlets
- For each outlet and material:
  - **Dispatched** column shows what was sent (read-only)
  - **Returned** column is where you enter what came back
- Enter the quantities that were returned from each outlet
- Click "Next" to continue

#### Step 2: Wastage Quantities (2/3)
- Similar table structure as Step 1
- Enter the quantities that were wasted at each outlet
- This is for tracking purposes only and doesn't affect inventory
- Click "Next" to continue

#### Step 3: Additional Information (3/3)
- For each outlet, enter:
  - **Cash**: Amount of cash collected
  - **Payment Onside**: Payment onside amount
- At the bottom, enter your name in the "Supervisor Name" field (required)
- Click "Review Checkout" to proceed

### 4. Review Your Entries
- A review modal will show all the data you entered:
  - Return items (only non-zero quantities)
  - Wastage items (only non-zero quantities)
  - Additional financial information
  - Your supervisor name
- Review carefully
- Click "Back to Edit" if you need to make changes
- Click "Confirm" to proceed

### 5. Final Confirmation
- A warning message will appear reminding you that this will update the cloud kitchen inventory
- Click "Cancel" to go back
- Click "Confirm" to submit the checkout

### 6. Success!
- The checkout form is created and confirmed
- Returned materials are automatically added back to the cloud kitchen inventory
- You'll see a success message
- The checkout will appear in the "Previous Checkouts" section

## Important Notes

### Inventory Impact
- **Returned materials**: Automatically added back to cloud kitchen inventory
- **Wasted materials**: Recorded for tracking only, does NOT affect inventory
- **Financial info**: Stored for analytics, does NOT affect inventory

### Unit Cost for Returns
- When materials are returned, the system uses the unit cost from the most recent batch of that material
- If no previous batch exists, the unit cost defaults to 0
- GST is always 0 for returned materials

### Time Window
- You can only create checkouts for dispatch plans locked within the last 24 hours
- After 24 hours, the dispatch plan will no longer appear in the available list

### One Checkout Per Dispatch Plan
- Each dispatch plan can only have ONE checkout form
- Once created, you cannot create another checkout for the same dispatch plan
- The "Create Checkout" button will be replaced with a "Checked Out" badge

## Viewing Previous Checkouts

The "Previous Checkouts" section shows all your past checkout forms with:
- Supervisor name
- Date of the dispatch plan
- Creation timestamp
- Status badge (DRAFT, SUBMITTED, or CONFIRMED)

## Troubleshooting

### "No locked dispatch plans available"
- The Dispatch Executive hasn't locked any plans yet
- OR all locked plans are older than 24 hours
- OR checkouts have already been created for all available plans

### "Please enter supervisor name"
- The supervisor name field is required in Step 3
- Make sure to fill it in before clicking "Review Checkout"

### "Failed to confirm checkout"
- Check your internet connection
- Ensure the dispatch plan is still locked
- Contact your administrator if the issue persists

## Tips for Efficient Use

1. **Prepare your data**: Have all return quantities, wastage amounts, and financial info ready before starting
2. **Double-check quantities**: Use the review modal to verify all entries before final confirmation
3. **Complete promptly**: Create checkouts as soon as possible after the business day ends (within 24 hours)
4. **Track wastage patterns**: Use the wastage data to identify outlets with high waste for improvement

## Need Help?

Contact your system administrator or refer to the full implementation documentation in `CHECKOUT_FEATURE_IMPLEMENTATION.md`.

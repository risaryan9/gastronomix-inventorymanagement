# Rollout Plan: Non-Food Tracking & Dispatch Plan Tracking

## Track 1 — Non-Food Tracking Rollout

> ⚠️ **Risk**: This rollout may interfere with the current raw-materials tracking. Plan staging carefully.

### End-to-end flow
```
Purchase Manager Stock In
        ↓
Supervisor creates Allocation Request
        ↓
Purchase Manager confirms Allocation Request
        ↓
Day-to-Day Operator records consumption
        ↓
Supervisor submits Closing Form (operator-scoped)
```

### Rollout steps
1. **Supervisor Staff training** — Nippu Kodi and El Chaapo brands. Cover Requisition creation and Closing Form submission. Start with a small set of outlets.
2. **Boom Pizza Operator Staff training** — Requisition creation. Begin with a single outlet.
3. **Test flow iterations** — Run the full non-food flow for El Chaapo and Nippu Kodi. Include edge case testing.
4. **Boom Pizza requisitions testing** — Verify the operator-scoped requisition path.
5. **Inventory seeding** — Update inventory with non-food materials for **all cloud kitchens across all 3 brands**.
6. **Outlet enablement** — Begin with a few outlets to test. **Preferred approach: enable all outlets at once** to avoid inventory management split-state difficulties.


---










## Track 2 — Production / Dispatch Plan Tracking Rollout

> ✅ **Risk**: Minimal hindrance to the current operational flow.

### End-to-end flow
```
Dispatch Executive creates Dispatch Plan
        ↓
Kitchen Executive confirms and creates Manual Plan
        ↓
Manual Stock Operation Plan sent to Purchase Manager
        ↓
Purchase Manager performs Stock In / Stock Out operations
```

### Rollout steps
1. **Training**
   - Dispatch Executive Staff training
   - Kitchen Executive Staff training
2. **Flow testing** — Run end-to-end with edge case scenarios.
3. **Inventory seeding** — Seed semi-finished and finished food inventory.
4. **Implementation** — Roll out the Dispatch Plan flow.


---

## Sequencing Recommendation
- **Dispatch track** can start first — it carries minimal risk to existing flows.
- **Non-Food track** should follow once dispatch is stable, since it touches active raw-materials tracking.

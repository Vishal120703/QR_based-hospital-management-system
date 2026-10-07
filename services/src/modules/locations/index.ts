// Public interface of the locations module: the Building → Floor → Ward →
// Room → Bed hierarchy, and bed occupancy (used by bed sessions).
export { occupyBed, releaseBed } from './bed-occupancy.js';
export { LocationController } from './location.controller.js';
export { createLocationRoutes } from './location.routes.js';
export { areaFilters, LocationService } from './location.service.js';

// Public interface of the hospitals module: hospital onboarding, the
// hospital profile and logo, and the rule for when a hospital is open.
export {
  bootstrapHospital,
  type BootstrapCreatedHospital,
  type NewClientInput,
} from './onboarding.service.js';
export { hospitalAccessSelect, hospitalIsOpen } from './hospital-access.js';
export { HospitalController } from './hospital.controller.js';
export { createHospitalRoutes, createPublicLogoRoutes } from './hospital.routes.js';
export { HospitalService } from './hospital.service.js';
export { detectLogoType, logoUrl, maxLogoBytes, removeLogo, storeLogo } from './logo.js';

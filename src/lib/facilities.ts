/**
 * facilities.ts — Pilot facility directory for SwasthyaSetu AI.
 *
 * These are pilot-block seed data for the Sitapur pilot (Uttar Pradesh),
 * mirroring — without the "Simulated"/"Demo" wording — the facilities the
 * app previously hardcoded as strings, e.g.:
 *   'Simulated PHC Rampur, Sitapur — Uttar Pradesh (Demo)'
 *   'Simulated PHC Rampur ... — Maternal High-Risk Clinic (Demo)'
 *   'Simulated CHC Sitapur Block — Uttar Pradesh (Demo)'
 *   'Sub-Centre Rampur · Sitapur, Uttar Pradesh'
 *
 * NOTE: Names, block and catchment details are seed values and must be
 * confirmed by the user against the actual pilot facilities before any
 * production use. Do not treat this list as a verified facility registry.
 */

export type FacilityType = 'PHC' | 'CHC' | 'SubCentre' | 'DistrictHospital';

export interface Facility {
  id: string;
  name: string;
  type: FacilityType;
  village?: string;
  block: string;
  district: string;
  state: string;
}

export const PILOT_FACILITIES: Facility[] = [
  {
    id: 'phc-rampur',
    name: 'PHC Rampur',
    type: 'PHC',
    village: 'Rampur',
    block: 'Sitapur',
    district: 'Sitapur',
    state: 'Uttar Pradesh',
  },
  {
    id: 'phc-rampur-maternal',
    name: 'PHC Rampur — Maternal High-Risk Clinic',
    type: 'PHC',
    village: 'Rampur',
    block: 'Sitapur',
    district: 'Sitapur',
    state: 'Uttar Pradesh',
  },
  {
    id: 'chc-sitapur',
    name: 'CHC Sitapur',
    type: 'CHC',
    block: 'Sitapur',
    district: 'Sitapur',
    state: 'Uttar Pradesh',
  },
  {
    id: 'subcentre-rampur',
    name: 'Sub-Centre Rampur',
    type: 'SubCentre',
    village: 'Rampur',
    block: 'Sitapur',
    district: 'Sitapur',
    state: 'Uttar Pradesh',
  },
  {
    id: 'district-hospital-sitapur',
    name: 'District Hospital Sitapur',
    type: 'DistrictHospital',
    block: 'Sitapur',
    district: 'Sitapur',
    state: 'Uttar Pradesh',
  },
];

/** The default referral destination for the pilot: PHC Rampur. */
export function getDefaultReferralFacility(): Facility {
  const preferred = PILOT_FACILITIES.find((f) => f.id === 'phc-rampur');
  // PILOT_FACILITIES is a non-empty constant, so the fallback is defensive only.
  return preferred ?? PILOT_FACILITIES[0];
}

export function getFacilityById(id: string): Facility | undefined {
  return PILOT_FACILITIES.find((f) => f.id === id);
}

/** Human-readable one-line label, e.g. "PHC Rampur, Sitapur, Sitapur, Uttar Pradesh". */
export function formatFacilityLabel(facility: Facility): string {
  return `${facility.name}, ${facility.block}, ${facility.district}, ${facility.state}`;
}

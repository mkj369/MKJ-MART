/**
 * Administrative geography of Bangladesh used for addresses and delivery zones:
 * 8 divisions, 64 districts (official English spellings as revised in 2018).
 */
export const BD_DIVISIONS = {
  Dhaka: [
    'Dhaka',
    'Faridpur',
    'Gazipur',
    'Gopalganj',
    'Kishoreganj',
    'Madaripur',
    'Manikganj',
    'Munshiganj',
    'Narayanganj',
    'Narsingdi',
    'Rajbari',
    'Shariatpur',
    'Tangail',
  ],
  Chattogram: [
    'Bandarban',
    'Brahmanbaria',
    'Chandpur',
    'Chattogram',
    "Cox's Bazar",
    'Cumilla',
    'Feni',
    'Khagrachhari',
    'Lakshmipur',
    'Noakhali',
    'Rangamati',
  ],
  Rajshahi: ['Bogura', 'Chapainawabganj', 'Joypurhat', 'Naogaon', 'Natore', 'Pabna', 'Rajshahi', 'Sirajganj'],
  Khulna: [
    'Bagerhat',
    'Chuadanga',
    'Jashore',
    'Jhenaidah',
    'Khulna',
    'Kushtia',
    'Magura',
    'Meherpur',
    'Narail',
    'Satkhira',
  ],
  Barishal: ['Barguna', 'Barishal', 'Bhola', 'Jhalokati', 'Patuakhali', 'Pirojpur'],
  Sylhet: ['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet'],
  Rangpur: ['Dinajpur', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Panchagarh', 'Rangpur', 'Thakurgaon'],
  Mymensingh: ['Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur'],
} as const satisfies Record<string, readonly string[]>;

export type Division = keyof typeof BD_DIVISIONS;
export const DIVISION_NAMES = Object.keys(BD_DIVISIONS) as Division[];
export const ALL_DISTRICTS: string[] = DIVISION_NAMES.flatMap((d) => [...BD_DIVISIONS[d]]).sort((a, b) =>
  a.localeCompare(b),
);

export function isValidDivision(value: string): value is Division {
  return Object.prototype.hasOwnProperty.call(BD_DIVISIONS, value);
}

export function isValidDistrict(value: string): boolean {
  return ALL_DISTRICTS.includes(value);
}

export function districtBelongsToDivision(district: string, division: string): boolean {
  return isValidDivision(division) && (BD_DIVISIONS[division] as readonly string[]).includes(district);
}

export function divisionOfDistrict(district: string): Division | null {
  return DIVISION_NAMES.find((d) => (BD_DIVISIONS[d] as readonly string[]).includes(district)) ?? null;
}

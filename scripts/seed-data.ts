/**
 * Seed data definitions.
 *
 * BASE data (sizes, colours, delivery zones) is real configuration every store needs.
 * DEMO data (catalogue, accounts, coupons, orders) is FICTIONAL, flagged `is_demo = true`, and can be
 * removed from Admin → Settings → Demo data. Product photos in /public/images/demo are AI-generated
 * placeholders — replace them with real photography before launch.
 */

export const SIZES: { label: string; sortOrder: number }[] = [
  { label: 'XS', sortOrder: 10 },
  { label: 'S', sortOrder: 20 },
  { label: 'M', sortOrder: 30 },
  { label: 'L', sortOrder: 40 },
  { label: 'XL', sortOrder: 50 },
  { label: 'XXL', sortOrder: 60 },
  { label: '28', sortOrder: 100 },
  { label: '30', sortOrder: 110 },
  { label: '32', sortOrder: 120 },
  { label: '34', sortOrder: 130 },
  { label: '36', sortOrder: 140 },
  { label: '38', sortOrder: 150 },
  { label: '40', sortOrder: 200 },
  { label: '41', sortOrder: 210 },
  { label: '42', sortOrder: 220 },
  { label: '43', sortOrder: 230 },
  { label: '44', sortOrder: 240 },
  { label: 'One Size', sortOrder: 500 },
];

export const COLORS: { name: string; hex: string }[] = [
  { name: 'Black', hex: '#111111' },
  { name: 'Ivory', hex: '#F2EDE3' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Charcoal', hex: '#3D3D3F' },
  { name: 'Navy', hex: '#1F2A44' },
  { name: 'Sky Blue', hex: '#A9C4DE' },
  { name: 'Sand', hex: '#D8C3A0' },
  { name: 'Camel', hex: '#B88A5A' },
  { name: 'Olive', hex: '#6B6B3E' },
  { name: 'Maroon', hex: '#6E1F2A' },
  { name: 'Sage', hex: '#9CAF94' },
  { name: 'Indigo', hex: '#2F3E6E' },
  { name: 'Dusty Rose', hex: '#C99A9A' },
  { name: 'Brown', hex: '#6B4A32' },
  { name: 'Gold', hex: '#B08D57' },
];

export const SHIPPING_ZONES = [
  { name: 'Inside Dhaka', fee: 7_000, estimatedDays: '1–2 days', districts: ['Dhaka'], isDefault: false, sortOrder: 0 },
  {
    name: 'Dhaka Suburbs',
    fee: 11_000,
    estimatedDays: '2–3 days',
    districts: ['Gazipur', 'Manikganj', 'Munshiganj', 'Narayanganj', 'Narsingdi'],
    isDefault: false,
    sortOrder: 1,
  },
  { name: 'Outside Dhaka', fee: 14_000, estimatedDays: '3–5 days', districts: [], isDefault: true, sortOrder: 2 },
];

// ─── Demo catalogue ───────────────────────────────────────────────────────────

export const DEMO_CATEGORIES: {
  slug: string;
  name: string;
  description: string;
  parent?: string;
  sortOrder: number;
}[] = [
  { slug: 'men', name: 'Men', description: 'Panjabis, shirts and tailoring cut for the Bangladeshi climate.', sortOrder: 0 },
  { slug: 'women', name: 'Women', description: 'Kurtis, sarees and modern essentials.', sortOrder: 1 },
  { slug: 'accessories', name: 'Accessories', description: 'Leather goods, shawls and finishing touches.', sortOrder: 2 },
  { slug: 'panjabi', name: 'Panjabi', parent: 'men', description: 'Everyday cottons and festive silks.', sortOrder: 0 },
  { slug: 'shirts', name: 'Shirts', parent: 'men', description: 'Oxford, linen and poplin shirting.', sortOrder: 1 },
  { slug: 'tees-polos', name: 'T-Shirts & Polos', parent: 'men', description: 'Heavyweight jersey and piqué knits.', sortOrder: 2 },
  { slug: 'trousers', name: 'Trousers', parent: 'men', description: 'Chinos and tailored trousers.', sortOrder: 3 },
  { slug: 'outerwear', name: 'Outerwear', parent: 'men', description: 'Light layers for Dhaka winters.', sortOrder: 4 },
  { slug: 'kurtis-sets', name: 'Kurtis & Sets', parent: 'women', description: 'Block prints, muslin and co-ord sets.', sortOrder: 0 },
  { slug: 'dresses-skirts', name: 'Dresses & Skirts', parent: 'women', description: 'Linen dresses and fluid skirts.', sortOrder: 1 },
  { slug: 'tops-knitwear', name: 'Tops & Knitwear', parent: 'women', description: 'Shirts, cardigans and layers.', sortOrder: 2 },
  { slug: 'sarees', name: 'Sarees', parent: 'women', description: 'Handloom Jamdani and silk.', sortOrder: 3 },
  { slug: 'bags', name: 'Bags', parent: 'accessories', description: 'Full-grain leather bags.', sortOrder: 0 },
  { slug: 'shawls-scarves', name: 'Shawls & Scarves', parent: 'accessories', description: 'Pashmina and silk.', sortOrder: 1 },
  { slug: 'footwear', name: 'Footwear', parent: 'accessories', description: 'Handcrafted leather shoes.', sortOrder: 2 },
];

export const DEMO_COLLECTIONS = [
  {
    slug: 'festive-edit',
    name: 'The Festive Edit',
    description: 'Silk, zari and quiet gold for Eid gatherings and the wedding season.',
    imageUrl: '/images/demo/products/zari-silk-panjabi.webp',
    isFeatured: true,
    sortOrder: 0,
  },
  {
    slug: 'winter-layers',
    name: 'Winter Layers',
    description: 'Brushed wool, warm neutrals and easy layering for cool Dhaka evenings.',
    imageUrl: '/images/demo/products/wool-blend-overshirt.webp',
    isFeatured: true,
    sortOrder: 1,
  },
  {
    slug: 'everyday-essentials',
    name: 'Everyday Essentials',
    description: 'The pieces you reach for every day — honest fabrics, cut to last.',
    imageUrl: '/images/demo/products/oxford-button-down-shirt.webp',
    isFeatured: true,
    sortOrder: 2,
  },
];

export type DemoProduct = {
  slug: string;
  name: string;
  category: string;
  price: number; // taka
  compareAtPrice?: number; // taka
  status: 'active' | 'draft';
  featured?: boolean;
  daysOld: number;
  color: string;
  sizes: string[];
  stock: number[]; // per size
  image?: string;
  collections: string[];
  tags: string[];
  material: string;
  care: string;
  description: string;
  skuPrefix: string;
};

const CARE_COTTON = 'Machine wash cold on a gentle cycle. Dry in shade. Warm iron on the reverse.';
const CARE_DRY = 'Dry clean only. Store folded in the muslin bag provided.';

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    slug: 'signature-cotton-panjabi',
    name: 'Signature Cotton Panjabi',
    category: 'panjabi',
    price: 3450,
    status: 'active',
    featured: true,
    daysOld: 70,
    color: 'Ivory',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stock: [8, 14, 16, 10, 5],
    image: '/images/demo/products/signature-cotton-panjabi.webp',
    collections: ['festive-edit', 'everyday-essentials'],
    tags: ['panjabi', 'cotton', 'eid', 'festive', 'ivory'],
    material: '100% combed cotton, 140 GSM slub weave',
    care: CARE_COTTON,
    skuPrefix: 'MKJ-PJ-SIG',
    description:
      'Our signature panjabi in a breathable slub cotton that softens with every wash. A clean mandarin collar, concealed placket and side slits keep it sharp from Jumu’ah to dinner. Cut straight and knee-length, with enough ease for Dhaka humidity.',
  },
  {
    slug: 'zari-embroidered-silk-panjabi',
    name: 'Zari-Embroidered Silk Panjabi',
    category: 'panjabi',
    price: 7950,
    status: 'active',
    featured: true,
    daysOld: 40,
    color: 'Maroon',
    sizes: ['M', 'L', 'XL', 'XXL'],
    stock: [6, 7, 4, 2],
    image: '/images/demo/products/zari-silk-panjabi.webp',
    collections: ['festive-edit'],
    tags: ['panjabi', 'silk', 'zari', 'wedding', 'eid', 'festive'],
    material: 'Silk-blend (60% silk, 40% viscose) with antique-gold zari',
    care: CARE_DRY,
    skuPrefix: 'MKJ-PJ-ZRI',
    description:
      'A deep maroon silk-blend panjabi with antique-gold zari worked by hand along the collar, placket and cuffs. Rich without being loud — made for Eid mornings, holud evenings and every wedding invitation in between.',
  },
  {
    slug: 'oxford-button-down-shirt',
    name: 'Oxford Button-Down Shirt',
    category: 'shirts',
    price: 2450,
    status: 'active',
    daysOld: 95,
    color: 'White',
    sizes: ['S', 'M', 'L', 'XL'],
    stock: [9, 12, 11, 0],
    image: '/images/demo/products/oxford-button-down-shirt.webp',
    collections: ['everyday-essentials'],
    tags: ['shirt', 'oxford', 'office', 'cotton', 'white'],
    material: '100% cotton Oxford cloth',
    care: CARE_COTTON,
    skuPrefix: 'MKJ-SH-OXF',
    description:
      'The shirt that does everything. Substantial Oxford cotton, a soft-roll button-down collar and a curved hem that works tucked into chinos or worn loose over denim. Gets better with every wash.',
  },
  {
    slug: 'linen-camp-collar-shirt',
    name: 'Linen Camp-Collar Shirt',
    category: 'shirts',
    price: 2650,
    compareAtPrice: 3250,
    status: 'active',
    daysOld: 60,
    color: 'Sand',
    sizes: ['S', 'M', 'L', 'XL'],
    stock: [5, 9, 8, 6],
    image: '/images/demo/products/linen-camp-collar-shirt.webp',
    collections: ['everyday-essentials'],
    tags: ['shirt', 'linen', 'summer', 'sale', 'camp collar'],
    material: '100% European linen, garment-washed',
    care: 'Machine wash cold. Line dry. Linen is meant to crease — iron while slightly damp for a crisper look.',
    skuPrefix: 'MKJ-SH-LIN',
    description:
      'A relaxed, boxy camp-collar shirt in garment-washed linen the colour of river sand. Coconut-shell buttons and a straight hem made to be worn untucked through the hottest months.',
  },
  {
    slug: 'heavyweight-cotton-tee',
    name: 'Heavyweight Cotton Tee',
    category: 'tees-polos',
    price: 1150,
    status: 'active',
    daysOld: 110,
    color: 'Black',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stock: [18, 26, 24, 15, 8],
    image: '/images/demo/products/heavyweight-cotton-tee.webp',
    collections: ['everyday-essentials'],
    tags: ['t-shirt', 'tee', 'cotton', 'basics', 'black'],
    material: '100% combed cotton jersey, 240 GSM',
    care: CARE_COTTON,
    skuPrefix: 'MKJ-TS-HVY',
    description:
      'A dense 240 GSM jersey tee with a structured, relaxed fit and a ribbed collar that keeps its shape. Knitted and finished in Gazipur. The black that stays black.',
  },
  {
    slug: 'knitted-pique-polo',
    name: 'Knitted Piqué Polo',
    category: 'tees-polos',
    price: 1850,
    status: 'active',
    daysOld: 80,
    color: 'Navy',
    sizes: ['S', 'M', 'L', 'XL'],
    stock: [7, 10, 9, 3],
    image: '/images/demo/products/knitted-pique-polo.webp',
    collections: ['everyday-essentials'],
    tags: ['polo', 'pique', 'smart casual', 'navy'],
    material: '100% cotton piqué',
    care: CARE_COTTON,
    skuPrefix: 'MKJ-PL-PQE',
    description:
      'A refined piqué polo with a soft knitted collar and a three-button placket. Smart enough for the office, easy enough for the weekend — in a navy that goes with everything.',
  },
  {
    slug: 'tailored-chino-trousers',
    name: 'Tailored Chino Trousers',
    category: 'trousers',
    price: 2850,
    status: 'active',
    daysOld: 85,
    color: 'Camel',
    sizes: ['30', '32', '34', '36'],
    stock: [6, 11, 9, 4],
    image: '/images/demo/products/tailored-chino-trousers.webp',
    collections: ['everyday-essentials', 'winter-layers'],
    tags: ['chinos', 'trousers', 'cotton twill', 'camel'],
    material: '98% cotton, 2% elastane twill',
    care: CARE_COTTON,
    skuPrefix: 'MKJ-TR-CHN',
    description:
      'Flat-front chinos in a cotton twill with a touch of stretch, a sharp centre crease and a gently tapered leg. Equally at home under a panjabi-style kurta or with an Oxford shirt.',
  },
  {
    slug: 'wool-blend-overshirt',
    name: 'Wool-Blend Overshirt',
    category: 'outerwear',
    price: 5450,
    status: 'active',
    featured: true,
    daysOld: 9,
    color: 'Charcoal',
    sizes: ['M', 'L', 'XL'],
    stock: [6, 8, 5],
    image: '/images/demo/products/wool-blend-overshirt.webp',
    collections: ['winter-layers'],
    tags: ['overshirt', 'jacket', 'wool', 'winter', 'layering'],
    material: '70% wool, 30% polyester brushed flannel',
    care: CARE_DRY,
    skuPrefix: 'MKJ-OW-WOL',
    description:
      'A brushed wool-blend overshirt with twin flap pockets and dark horn buttons. Light enough for a December evening in Dhaka, warm enough for a winter trip to Sylhet or Sreemangal.',
  },
  {
    slug: 'structured-leather-tote',
    name: 'Structured Leather Tote',
    category: 'bags',
    price: 6950,
    status: 'active',
    featured: true,
    daysOld: 14,
    color: 'Black',
    sizes: ['One Size'],
    stock: [4],
    image: '/images/demo/products/structured-leather-tote.webp',
    collections: ['festive-edit'],
    tags: ['bag', 'tote', 'leather', 'gift'],
    material: 'Full-grain cowhide leather, cotton twill lining',
    care: 'Wipe with a soft dry cloth. Condition every few months. Keep away from direct sunlight.',
    skuPrefix: 'MKJ-BG-TOT',
    description:
      'A clean-lined tote in full-grain leather from tanneries in Savar, finished with tonal stitching and slim rolled handles. Fits a 14-inch laptop, a water bottle and everything else your day needs.',
  },
  // ── Drafts: products awaiting photography (not visible in the storefront) ──
  {
    slug: 'hand-block-print-kurti',
    name: 'Hand Block-Print Kurti',
    category: 'kurtis-sets',
    price: 2950,
    status: 'draft',
    daysOld: 3,
    color: 'Indigo',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    stock: [5, 8, 10, 8, 4],
    collections: [],
    tags: ['kurti', 'block print', 'cotton', 'indigo'],
    material: '100% cotton voile, hand block-printed',
    care: 'Hand wash separately in cold water. Dry in shade.',
    skuPrefix: 'MKJ-KT-BLK',
    description: 'An indigo cotton kurti hand block-printed with a small floral motif by artisans in Narsingdi.',
  },
  {
    slug: 'embroidered-muslin-kurta-set',
    name: 'Embroidered Muslin Kurta Set',
    category: 'kurtis-sets',
    price: 6450,
    status: 'draft',
    daysOld: 3,
    color: 'Ivory',
    sizes: ['S', 'M', 'L', 'XL'],
    stock: [3, 5, 5, 2],
    collections: ['festive-edit'],
    tags: ['kurta set', 'muslin', 'embroidery', 'festive'],
    material: 'Fine cotton muslin with tonal thread embroidery',
    care: CARE_DRY,
    skuPrefix: 'MKJ-KT-MSL',
    description: 'A two-piece ivory muslin kurta set with delicate tonal embroidery at the neckline and cuffs.',
  },
  {
    slug: 'linen-wrap-dress',
    name: 'Linen Wrap Dress',
    category: 'dresses-skirts',
    price: 3950,
    compareAtPrice: 4650,
    status: 'draft',
    daysOld: 3,
    color: 'Sage',
    sizes: ['XS', 'S', 'M', 'L'],
    stock: [4, 6, 6, 3],
    collections: [],
    tags: ['dress', 'linen', 'wrap'],
    material: '100% linen',
    care: 'Machine wash cold, line dry.',
    skuPrefix: 'MKJ-DR-WRP',
    description: 'A sage linen wrap dress with a self-tie waist and elbow-length sleeves.',
  },
  {
    slug: 'dhakai-jamdani-saree',
    name: 'Dhakai Jamdani Saree',
    category: 'sarees',
    price: 14500,
    status: 'draft',
    daysOld: 3,
    color: 'Ivory',
    sizes: ['One Size'],
    stock: [3],
    collections: ['festive-edit'],
    tags: ['saree', 'jamdani', 'handloom', 'wedding'],
    material: 'Handwoven cotton Jamdani with gold motifs',
    care: CARE_DRY,
    skuPrefix: 'MKJ-SR-JMD',
    description: 'A handwoven Dhakai Jamdani in ivory with gold motifs — woven on traditional looms in Rupganj.',
  },
  {
    slug: 'hand-woven-pashmina-shawl',
    name: 'Hand-Woven Pashmina Shawl',
    category: 'shawls-scarves',
    price: 3650,
    status: 'draft',
    daysOld: 3,
    color: 'Maroon',
    sizes: ['One Size'],
    stock: [10],
    collections: ['winter-layers'],
    tags: ['shawl', 'pashmina', 'winter', 'gift'],
    material: 'Pashmina wool blend',
    care: CARE_DRY,
    skuPrefix: 'MKJ-SW-PSH',
    description: 'A soft hand-woven pashmina shawl in deep maroon, generous enough to wrap twice.',
  },
  {
    slug: 'handcrafted-leather-loafers',
    name: 'Handcrafted Leather Loafers',
    category: 'footwear',
    price: 5250,
    status: 'draft',
    daysOld: 3,
    color: 'Brown',
    sizes: ['40', '41', '42', '43', '44'],
    stock: [3, 5, 6, 5, 2],
    collections: ['festive-edit'],
    tags: ['loafers', 'shoes', 'leather'],
    material: 'Full-grain leather upper, leather sole',
    care: 'Use shoe trees. Polish regularly.',
    skuPrefix: 'MKJ-FW-LOF',
    description: 'Hand-lasted penny loafers in polished brown leather.',
  },
];

// ─── Demo accounts, coupons, orders ───────────────────────────────────────────

export const DEMO_PASSWORDS = {
  admin: 'Admin@12345',
  staff: 'Staff@12345',
  customer: 'Customer@123',
};

export const DEMO_USERS = [
  { email: 'admin@mkjmart.demo', name: 'Demo Admin', role: 'admin' as const, password: DEMO_PASSWORDS.admin, phone: null },
  { email: 'staff@mkjmart.demo', name: 'Demo Staff', role: 'staff' as const, password: DEMO_PASSWORDS.staff, phone: null },
  {
    email: 'customer@mkjmart.demo',
    name: 'Ayesha Rahman',
    role: 'customer' as const,
    password: DEMO_PASSWORDS.customer,
    phone: '01711000001',
    address: { addressLine: 'House 14, Road 7, Block F', area: 'Banani', district: 'Dhaka', division: 'Dhaka', postalCode: '1213' },
  },
  {
    email: 'tanvir@mkjmart.demo',
    name: 'Tanvir Ahmed',
    role: 'customer' as const,
    password: DEMO_PASSWORDS.customer,
    phone: '01811000002',
    address: { addressLine: 'Flat 3B, Shapla Tower, Station Road', area: 'Tongi', district: 'Gazipur', division: 'Dhaka', postalCode: '1710' },
  },
  {
    email: 'nusrat@mkjmart.demo',
    name: 'Nusrat Jahan',
    role: 'customer' as const,
    password: DEMO_PASSWORDS.customer,
    phone: '01911000003',
    address: { addressLine: '22 Jamal Khan Road', area: 'Kotwali', district: 'Chattogram', division: 'Chattogram', postalCode: '4000' },
  },
  {
    email: 'farhan@mkjmart.demo',
    name: 'Farhan Hossain',
    role: 'customer' as const,
    password: DEMO_PASSWORDS.customer,
    phone: '01611000004',
    address: { addressLine: 'Holding 9, Zindabazar', area: 'Kotwali', district: 'Sylhet', division: 'Sylhet', postalCode: '3100' },
  },
];

export const DEMO_COUPONS = [
  {
    code: 'WELCOME10',
    description: '10% off your first order over ৳2,000 (max ৳500)',
    type: 'percentage' as const,
    value: 10,
    minOrderAmount: 200_000,
    maxDiscountAmount: 50_000,
    usageLimitPerCustomer: 1,
    usageLimit: null,
    endsAtDays: 60,
  },
  {
    code: 'FESTIVE500',
    description: '৳500 off festive orders over ৳6,000',
    type: 'fixed' as const,
    value: 50_000,
    minOrderAmount: 600_000,
    maxDiscountAmount: null,
    usageLimitPerCustomer: 2,
    usageLimit: 200,
    endsAtDays: 45,
  },
  {
    code: 'MONSOON15',
    description: 'Expired monsoon promotion (kept for reporting)',
    type: 'percentage' as const,
    value: 15,
    minOrderAmount: 0,
    maxDiscountAmount: 100_000,
    usageLimitPerCustomer: null,
    usageLimit: null,
    endsAtDays: -20,
  },
];

/** Demo order plan: [customer email | guest, items (slug:size:qty), days ago, final status, coupon]. */
export const DEMO_ORDERS: {
  customer: string | { name: string; phone: string; address: { addressLine: string; area: string; district: string; division: string } };
  items: string[];
  daysAgo: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  coupon?: string;
  note?: string;
}[] = [
  { customer: 'customer@mkjmart.demo', items: ['signature-cotton-panjabi:L:1', 'tailored-chino-trousers:32:1'], daysAgo: 27, status: 'delivered', coupon: 'WELCOME10' },
  { customer: 'tanvir@mkjmart.demo', items: ['heavyweight-cotton-tee:M:2', 'knitted-pique-polo:M:1'], daysAgo: 25, status: 'delivered' },
  {
    customer: { name: 'Sabbir Khan', phone: '01521000005', address: { addressLine: 'House 3, Lane 2, Sector 11', area: 'Uttara', district: 'Dhaka', division: 'Dhaka' } },
    items: ['zari-embroidered-silk-panjabi:XL:1'],
    daysAgo: 22,
    status: 'delivered',
  },
  { customer: 'nusrat@mkjmart.demo', items: ['structured-leather-tote:One Size:1'], daysAgo: 19, status: 'delivered', coupon: 'FESTIVE500' },
  { customer: 'farhan@mkjmart.demo', items: ['oxford-button-down-shirt:L:1', 'heavyweight-cotton-tee:L:1'], daysAgo: 16, status: 'delivered' },
  {
    customer: { name: 'Mehjabin Chowdhury', phone: '01721000006', address: { addressLine: 'Road 27, House 41', area: 'Dhanmondi', district: 'Dhaka', division: 'Dhaka' } },
    items: ['linen-camp-collar-shirt:M:1', 'heavyweight-cotton-tee:S:1'],
    daysAgo: 13,
    status: 'cancelled',
    note: 'Customer requested cancellation by phone.',
  },
  { customer: 'customer@mkjmart.demo', items: ['wool-blend-overshirt:M:1'], daysAgo: 8, status: 'shipped' },
  { customer: 'tanvir@mkjmart.demo', items: ['signature-cotton-panjabi:XL:2'], daysAgo: 6, status: 'delivered' },
  {
    customer: { name: 'Rafiq Islam', phone: '01821000007', address: { addressLine: 'Shaheb Bazar Road', area: 'Boalia', district: 'Rajshahi', division: 'Rajshahi' } },
    items: ['tailored-chino-trousers:34:1', 'knitted-pique-polo:L:1'],
    daysAgo: 4,
    status: 'shipped',
  },
  { customer: 'nusrat@mkjmart.demo', items: ['zari-embroidered-silk-panjabi:L:1', 'signature-cotton-panjabi:M:1'], daysAgo: 3, status: 'processing' },
  { customer: 'farhan@mkjmart.demo', items: ['heavyweight-cotton-tee:XL:3'], daysAgo: 2, status: 'confirmed' },
  {
    customer: { name: 'Shirin Akter', phone: '01921000008', address: { addressLine: 'College Road, House 18', area: 'Sadar', district: 'Narayanganj', division: 'Dhaka' } },
    items: ['linen-camp-collar-shirt:L:1'],
    daysAgo: 1,
    status: 'pending',
  },
  { customer: 'customer@mkjmart.demo', items: ['structured-leather-tote:One Size:1'], daysAgo: 0, status: 'pending' },
];

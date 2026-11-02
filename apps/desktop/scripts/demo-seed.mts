import { createApp } from '@inv/api'
import { createSqliteDb } from '@inv/db'

export const DEMO_LOGIN = { username: 'demo', password: 'Demo12345' }
const STAFF_PASSWORD = 'Staff12345'

const HISTORY_DAYS = 90
const PIASTRES = 100

interface ItemSeed {
  name: string
  nameEn: string
  generic?: string
  category: string
  brand: string
  /** Strips per box for medicines. Anything else is sold by the piece. */
  strips?: number
  /** Per strip, or per piece. */
  cost: number
  price: number
  reorder: number
  popularity: number
  prescription?: boolean
  taxed?: boolean
  /** Never restocked, so the reorder list and the dashboard alert have something real to show. */
  lean?: boolean
  /** Never sold, so the slow stock report has something honest to show. */
  slow?: boolean
}

// Invented names, so no real manufacturer's product appears in a demo.
const ITEMS: ItemSeed[] = [
  { name: 'باراسيتامول 500 مجم', nameEn: 'Paracetamol 500mg', generic: 'Paracetamol', category: 'مسكنات وخافضات حرارة', brand: 'النيل فارما', strips: 2, cost: 9, price: 14, reorder: 40, popularity: 10 },
  { name: 'إيبوبروفين 400 مجم', nameEn: 'Ibuprofen 400mg', generic: 'Ibuprofen', category: 'مسكنات وخافضات حرارة', brand: 'النيل فارما', strips: 3, cost: 11, price: 17, reorder: 30, popularity: 8 },
  { name: 'ديكلوفيناك 50 مجم', nameEn: 'Diclofenac 50mg', generic: 'Diclofenac', category: 'مسكنات وخافضات حرارة', brand: 'دلتا ميد', strips: 2, cost: 13, price: 21, reorder: 20, popularity: 5, lean: true },
  { name: 'أسبرين 81 مجم', nameEn: 'Aspirin 81mg', generic: 'Acetylsalicylic acid', category: 'قلب وضغط', brand: 'دلتا ميد', strips: 3, cost: 8, price: 13, reorder: 30, popularity: 6 },
  { name: 'أموكسيسيلين 500 مجم', nameEn: 'Amoxicillin 500mg', generic: 'Amoxicillin', category: 'مضادات حيوية', brand: 'الشرق فارما', strips: 2, cost: 24, price: 36, reorder: 20, popularity: 7, prescription: true },
  { name: 'أزيثروميسين 500 مجم', nameEn: 'Azithromycin 500mg', generic: 'Azithromycin', category: 'مضادات حيوية', brand: 'الشرق فارما', strips: 1, cost: 62, price: 90, reorder: 12, popularity: 4, prescription: true },
  { name: 'سيبروفلوكساسين 500 مجم', nameEn: 'Ciprofloxacin 500mg', generic: 'Ciprofloxacin', category: 'مضادات حيوية', brand: 'الشرق فارما', strips: 2, cost: 31, price: 46, reorder: 15, popularity: 3, prescription: true, lean: true },
  { name: 'ميتفورمين 850 مجم', nameEn: 'Metformin 850mg', generic: 'Metformin', category: 'سكر', brand: 'كير ميد', strips: 5, cost: 12, price: 18, reorder: 40, popularity: 7, prescription: true },
  { name: 'جليميبيريد 2 مجم', nameEn: 'Glimepiride 2mg', generic: 'Glimepiride', category: 'سكر', brand: 'كير ميد', strips: 3, cost: 17, price: 25, reorder: 20, popularity: 4, prescription: true, lean: true },
  { name: 'أملوديبين 5 مجم', nameEn: 'Amlodipine 5mg', generic: 'Amlodipine', category: 'قلب وضغط', brand: 'كير ميد', strips: 3, cost: 16, price: 24, reorder: 25, popularity: 6, prescription: true },
  { name: 'بيسوبرولول 5 مجم', nameEn: 'Bisoprolol 5mg', generic: 'Bisoprolol', category: 'قلب وضغط', brand: 'كير ميد', strips: 3, cost: 21, price: 32, reorder: 20, popularity: 4, prescription: true },
  { name: 'أتورفاستاتين 20 مجم', nameEn: 'Atorvastatin 20mg', generic: 'Atorvastatin', category: 'قلب وضغط', brand: 'دلتا ميد', strips: 3, cost: 34, price: 49, reorder: 15, popularity: 3, prescription: true },
  { name: 'أوميبرازول 20 مجم', nameEn: 'Omeprazole 20mg', generic: 'Omeprazole', category: 'جهاز هضمي', brand: 'النيل فارما', strips: 2, cost: 19, price: 29, reorder: 25, popularity: 7 },
  { name: 'دومبيريدون 10 مجم', nameEn: 'Domperidone 10mg', generic: 'Domperidone', category: 'جهاز هضمي', brand: 'النيل فارما', strips: 2, cost: 10, price: 16, reorder: 20, popularity: 5 },
  { name: 'لوراتادين 10 مجم', nameEn: 'Loratadine 10mg', generic: 'Loratadine', category: 'حساسية', brand: 'الشرق فارما', strips: 2, cost: 12, price: 19, reorder: 20, popularity: 6, lean: true },
  { name: 'سيتريزين 10 مجم', nameEn: 'Cetirizine 10mg', generic: 'Cetirizine', category: 'حساسية', brand: 'الشرق فارما', strips: 2, cost: 11, price: 17, reorder: 20, popularity: 4 },
  { name: 'فيتامين سي 1000 مجم', nameEn: 'Vitamin C 1000mg', generic: 'Ascorbic acid', category: 'فيتامينات ومكملات', brand: 'نوفا هيلث', cost: 62, price: 95, reorder: 15, popularity: 8, taxed: true },
  { name: 'فيتامين د3 5000 وحدة', nameEn: 'Vitamin D3 5000 IU', generic: 'Cholecalciferol', category: 'فيتامينات ومكملات', brand: 'نوفا هيلث', cost: 88, price: 130, reorder: 12, popularity: 6, taxed: true },
  { name: 'زنك 50 مجم', nameEn: 'Zinc 50mg', generic: 'Zinc', category: 'فيتامينات ومكملات', brand: 'نوفا هيلث', cost: 54, price: 82, reorder: 12, popularity: 5, taxed: true, lean: true },
  { name: 'أوميجا 3 كبسولات', nameEn: 'Omega 3 capsules', generic: 'Fish oil', category: 'فيتامينات ومكملات', brand: 'نوفا هيلث', cost: 118, price: 175, reorder: 10, popularity: 3, taxed: true },
  { name: 'حديد وحمض فوليك', nameEn: 'Iron and folic acid', generic: 'Ferrous fumarate', category: 'فيتامينات ومكملات', brand: 'نوفا هيلث', cost: 46, price: 70, reorder: 10, popularity: 4, taxed: true },
  { name: 'شراب كحة للأطفال 120 مل', nameEn: 'Kids cough syrup 120ml', category: 'أطفال', brand: 'لمسة', cost: 28, price: 45, reorder: 15, popularity: 6 },
  { name: 'خافض حرارة أطفال 100 مل', nameEn: 'Kids fever syrup 100ml', generic: 'Paracetamol', category: 'أطفال', brand: 'لمسة', cost: 22, price: 36, reorder: 20, popularity: 7 },
  { name: 'حفاضات مقاس 4 عبوة 40', nameEn: 'Diapers size 4, 40 pack', category: 'أطفال', brand: 'لمسة', cost: 170, price: 240, reorder: 10, popularity: 5, taxed: true },
  { name: 'مناديل مبللة للأطفال', nameEn: 'Baby wipes', category: 'أطفال', brand: 'لمسة', cost: 32, price: 52, reorder: 12, popularity: 5, taxed: true, lean: true },
  { name: 'كريم مرطب للبشرة 100 مل', nameEn: 'Moisturizing cream 100ml', category: 'عناية بالبشرة', brand: 'بشرتي', cost: 75, price: 120, reorder: 10, popularity: 4, taxed: true },
  { name: 'واقي شمس SPF 50', nameEn: 'Sunscreen SPF 50', category: 'عناية بالبشرة', brand: 'بشرتي', cost: 165, price: 245, reorder: 8, popularity: 3, taxed: true },
  { name: 'غسول وجه للبشرة الدهنية', nameEn: 'Face wash for oily skin', category: 'عناية بالبشرة', brand: 'بشرتي', cost: 92, price: 145, reorder: 8, popularity: 3, taxed: true },
  { name: 'شامبو ضد القشرة 200 مل', nameEn: 'Anti-dandruff shampoo 200ml', category: 'عناية بالبشرة', brand: 'بشرتي', cost: 68, price: 105, reorder: 8, popularity: 3, taxed: true },
  { name: 'معجون أسنان للثة الحساسة', nameEn: 'Sensitive gums toothpaste', category: 'عناية بالبشرة', brand: 'بشرتي', cost: 41, price: 65, reorder: 10, popularity: 4, taxed: true },
  { name: 'جهاز قياس ضغط رقمي', nameEn: 'Digital blood pressure monitor', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 780, price: 1150, reorder: 3, popularity: 1, taxed: true },
  { name: 'جهاز قياس سكر', nameEn: 'Blood glucose meter', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 420, price: 650, reorder: 3, popularity: 1, taxed: true },
  { name: 'شرائط قياس سكر 50 شريط', nameEn: 'Glucose test strips, 50', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 260, price: 370, reorder: 8, popularity: 4, taxed: true },
  { name: 'ترمومتر رقمي', nameEn: 'Digital thermometer', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 58, price: 95, reorder: 5, popularity: 2, taxed: true, lean: true },
  { name: 'كمامات طبية عبوة 50', nameEn: 'Medical masks, 50 pack', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 44, price: 75, reorder: 12, popularity: 4, taxed: true },
  { name: 'شاش طبي معقم', nameEn: 'Sterile gauze', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 7, price: 13, reorder: 25, popularity: 5, taxed: true },
  { name: 'بلاستر طبي علبة 20', nameEn: 'Plasters, box of 20', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 16, price: 28, reorder: 20, popularity: 5, taxed: true },
  { name: 'كحول طبي 70% 250 مل', nameEn: 'Rubbing alcohol 70% 250ml', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 19, price: 32, reorder: 15, popularity: 4, taxed: true },
  { name: 'حزام دعم للظهر', nameEn: 'Back support belt', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 210, price: 340, reorder: 2, popularity: 0, taxed: true, slow: true },
  { name: 'رباط ركبة طبي', nameEn: 'Knee support', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 130, price: 215, reorder: 2, popularity: 0, taxed: true, slow: true },
  { name: 'كرسي استحمام طبي', nameEn: 'Medical shower chair', category: 'مستلزمات طبية', brand: 'ميديكو', cost: 640, price: 950, reorder: 1, popularity: 0, taxed: true, slow: true },
]

// Stock that came in short-dated, in quantities a shop won't sell before the date arrives.
const SHORT_DATED: Array<[name: string, qty: number, days: number]> = [
  ['شامبو ضد القشرة 200 مل', 40, -6],
  ['واقي شمس SPF 50', 30, 18],
  ['أتورفاستاتين 20 مجم', 80, 33],
  ['غسول وجه للبشرة الدهنية', 30, 47],
  ['أوميجا 3 كبسولات', 30, 62],
]

const SUPPLIERS = [
  { name: 'شركة النيل لتوزيع الأدوية', phone: '0223456701', address: 'مدينة نصر، القاهرة', taxNumber: '200100300', brands: ['النيل فارما', 'دلتا ميد'] },
  { name: 'الشرق للأدوية والمستلزمات', phone: '0223456702', address: 'الدقي، الجيزة', taxNumber: '200100301', brands: ['الشرق فارما', 'كير ميد'] },
  { name: 'نوفا للمكملات الغذائية', phone: '0223456703', address: 'سموحة، الإسكندرية', taxNumber: '200100302', brands: ['نوفا هيلث'] },
  { name: 'بيت التجميل للتوريدات', phone: '0223456704', address: 'المعادي، القاهرة', taxNumber: '200100303', brands: ['بشرتي', 'لمسة'] },
  { name: 'ميديكو للأجهزة الطبية', phone: '0223456705', address: 'العبور، القليوبية', taxNumber: '200100304', brands: ['ميديكو'] },
]

const CUSTOMERS = [
  { name: 'محمد عبد الرحمن', phone: '01000000101', limit: 3000 },
  { name: 'فاطمة السيد', phone: '01000000102', limit: 2000 },
  { name: 'عيادة الرحمة', phone: '01000000103', limit: 10000 },
  { name: 'خالد إبراهيم', phone: '01000000104', limit: 1500 },
  { name: 'منى عادل', phone: '01000000105', limit: 2500 },
  { name: 'دار رعاية النور', phone: '01000000106', limit: 15000 },
  { name: 'يوسف حسن', phone: '01000000107', limit: 1000 },
  { name: 'نورا مصطفى', phone: '01000000108', limit: 2000 },
]

/** Fixed sequence, so every demo database tells the same story. */
function randomFrom(seed: number) {
  let state = seed
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (from: number, to: number) => from + Math.floor(next() * (to - from + 1)),
    pick: <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
  }
}

const localDate = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

function dayAt(offset: number, hour: number, minute = 0): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, hour, minute)
}

const dateIn = (days: number) => localDate(dayAt(-days, 12))

function barcodeFor(index: number, salt: number): string {
  const body = `622${String(1000000 + salt * 10000 + index).padStart(9, '0')}`
  const sum = [...body].reduce((total, digit, position) => total + Number(digit) * (position % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

interface Item extends ItemSeed {
  variantId: string
  productId: string
  unitId: string
  costMinor: number
  priceMinor: number
}

/** Goes through the real API with a clock it can turn, so history reads as if the shop lived it. */
export async function seedDemo(options: { path: string; hexKey: string; backupsDir: string }): Promise<{ recoveryCode: string }> {
  const random = randomFrom(20261101)
  const db = createSqliteDb({ path: options.path, hexKey: options.hexKey })
  let clock = dayAt(HISTORY_DAYS + 2, 9).getTime()
  let requests = 0
  const requestId = () => `demo-request-${String(++requests).padStart(8, '0')}`

  const app = createApp({
    db,
    token: 'demo',
    allowedOrigin: 'app://renderer',
    version: '1.0.0',
    bootCount: 1,
    databaseKey: options.hexKey,
    backupsDir: options.backupsDir,
    clock: () => clock,
    logError: (message, details) => console.error(message, details),
  })

  async function call<T>(method: string, route: string, session: string | null, body?: unknown): Promise<T> {
    const response = await app.request(route, {
      method,
      headers: {
        Authorization: 'Bearer demo',
        ...(session ? { 'X-Session-Token': session } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status !== 200) throw new Error(`${method} ${route} ${response.status}: ${await response.text()}`)
    return (await response.json()) as T
  }

  const onboarding = await call<{ token: string; recoveryCode: string }>('POST', '/onboarding', null, {
    locale: 'ar',
    store: { name: 'صيدلية الشفاء', businessType: 'pharmacy' },
    owner: { fullName: 'د. أحمد سامي', username: DEMO_LOGIN.username, password: DEMO_LOGIN.password },
  })
  let owner = onboarding.token
  const login = async (username: string, password: string) => (await call<{ token: string }>('POST', '/auth/login', null, { username, password })).token

  await call('PUT', '/settings/store', owner, { name: 'صيدلية الشفاء', phone: '0225550100', address: '12 شارع النصر، المعادي، القاهرة', taxNumber: '300400500' })
  await call('PUT', '/settings/preferences', owner, { locale: 'ar', theme: 'light', digits: 'latin' })

  const { items: roles } = await call<{ items: Array<{ id: string; name: string }> }>('GET', '/roles', owner)
  const roleId = (id: string) => roles.find((role) => role.id === id)?.id ?? roles[0]!.id
  await call('POST', '/users', owner, { fullName: 'سارة أحمد', username: 'sara', password: 'Demo12345', roleId: roleId('manager'), pin: '1234' })
  await call('POST', '/users', owner, { fullName: 'نور حسن', username: 'nour', password: 'Demo12345', roleId: roleId('cashier'), pin: '4321' })
  await call('POST', '/users', owner, { fullName: 'محمود علي', username: 'mahmoud', password: 'Demo12345', roleId: roleId('storekeeper') })
  // New staff choose their own password at first sign-in, so this one does it the same way.
  await call('POST', '/auth/change-password', await login('sara', 'Demo12345'), { currentPassword: 'Demo12345', newPassword: STAFF_PASSWORD })

  const categories = new Map<string, string>()
  const brands = new Map<string, string>()
  for (const name of new Set(ITEMS.map(({ category }) => category))) {
    categories.set(name, (await call<{ id: string }>('POST', '/catalog/categories', owner, { name })).id)
  }
  for (const name of new Set(ITEMS.map(({ brand }) => brand))) {
    brands.set(name, (await call<{ id: string }>('POST', '/catalog/brands', owner, { name })).id)
  }
  const { items: taxRates } = await call<{ items: Array<{ id: string }> }>('GET', '/catalog/tax-rates', owner)
  const taxRateId = taxRates[0]?.id ?? (await call<{ id: string }>('POST', '/catalog/tax-rates', owner, { name: 'ضريبة القيمة المضافة 14%', rateBp: 1400 })).id
  const branch = await call<{ id: string }>('POST', '/catalog/warehouses', owner, { name: 'مخزن الفرع' })
  const wholesale = await call<{ id: string }>('POST', '/catalog/price-lists', owner, { name: 'سعر العيادات' })

  const items: Item[] = []
  for (const [index, seed] of ITEMS.entries()) {
    const costMinor = seed.cost * PIASTRES
    const priceMinor = seed.price * PIASTRES
    const baseUnit = seed.strips ? 'strip' : 'piece'
    const boxPrice = seed.strips ? [{ priceListId: 'retail', unitId: 'box', amountMinor: priceMinor * seed.strips }] : []
    const product = await call<{ id: string; variants: Array<{ id: string }> }>('POST', '/products', owner, {
      name: seed.name,
      nameEn: seed.nameEn,
      genericName: seed.generic ?? null,
      categoryId: categories.get(seed.category),
      brandId: brands.get(seed.brand),
      taxRateId: seed.taxed ? taxRateId : null,
      baseUnitId: baseUnit,
      prescriptionRequired: seed.prescription ?? false,
      trackLots: true,
      trackSerials: false,
      conversions: seed.strips ? [{ unitId: 'box', factorMilli: seed.strips * 1000 }] : [],
      variants: [
        {
          label: null,
          costMinor,
          reorderLevelMilli: seed.reorder * 1000,
          barcodes: [{ code: barcodeFor(index, 1), unitId: baseUnit }, ...(seed.strips ? [{ code: barcodeFor(index, 2), unitId: 'box' }] : [])],
          prices: [
            { priceListId: 'retail', unitId: baseUnit, amountMinor: priceMinor },
            { priceListId: wholesale.id, unitId: baseUnit, amountMinor: Math.round(priceMinor * 0.9) },
            ...boxPrice,
          ],
          attributeValueIds: [],
        },
      ],
    })
    items.push({ ...seed, productId: product.id, variantId: product.variants[0]!.id, unitId: baseUnit, costMinor, priceMinor })
  }

  const suppliers = new Map<string, { id: string; brands: string[] }>()
  for (const { brands: supplied, ...supplier } of SUPPLIERS) {
    const created = await call<{ id: string }>('POST', '/suppliers', owner, { ...supplier, openingBalanceMinor: random.int(2, 12) * 500 * PIASTRES })
    suppliers.set(supplier.name, { id: created.id, brands: supplied })
  }
  const customers: Array<{ id: string; name: string }> = []
  for (const customer of CUSTOMERS) {
    const created = await call<{ id: string }>('POST', '/customers', owner, {
      name: customer.name,
      phone: customer.phone,
      creditLimitMinor: customer.limit * PIASTRES,
    })
    customers.push({ id: created.id, name: customer.name })
  }

  let lotNumber = 4100
  const lotFor = (offset: number) => ({
    lotNo: `L${++lotNumber}`,
    expiryDate: dateIn(HISTORY_DAYS - offset + random.int(240, 700)),
  })

  const purchaseLine = (item: Item, qty: number, offset: number, orderLineId?: string) => ({
    variantId: item.variantId,
    unitId: item.unitId,
    qtyMilli: qty * 1000,
    unitCostMinor: item.costMinor,
    discountMinor: 0,
    taxRateBp: 0,
    ...lotFor(offset),
    ...(orderLineId ? { orderLineId } : {}),
  })

  async function buy(supplierId: string, chosen: Item[], offset: number, scale: number, paidShare: number) {
    const lines = chosen.map((item) => purchaseLine(item, Math.max(item.reorder * scale, 6), offset))
    const total = lines.reduce((sum, line) => sum + (line.qtyMilli / 1000) * line.unitCostMinor, 0)
    const purchase = await call<{ id: string }>('POST', '/purchases', owner, {
      kind: 'invoice',
      supplierId,
      warehouseId: 'main',
      supplierReference: `INV-${random.int(10000, 99999)}`,
      ...(paidShare > 0 ? { paidMinor: Math.round(total * paidShare), paymentMethod: random.pick(['cash', 'bank', 'wallet'] as const) } : {}),
      lines,
    })
    await call('POST', `/purchases/${purchase.id}/post`, owner)
  }

  // Opening stock arrives from each supplier.
  for (const supplier of suppliers.values()) {
    await buy(supplier.id, items.filter(({ brand }) => supplier.brands.includes(brand)), HISTORY_DAYS, 5, 0.4)
    clock += 40 * 60_000
  }

  const sold: Array<{ id: string; lines: Array<{ id: string; qtyMilli: number }> }> = []
  const weighted = items.flatMap((item) => Array.from({ length: item.popularity }, () => item))

  async function sell(session: string, offset: number) {
    const lines = new Map<string, { item: Item; qty: number }>()
    for (let count = random.int(1, 4); count > 0; count--) {
      const item = random.pick(weighted)
      lines.set(item.variantId, { item, qty: random.int(1, item.strips ? 3 : 2) })
    }
    const body = [...lines.values()].map(({ item, qty }) => ({
      variantId: item.variantId,
      unitId: item.unitId,
      qtyMilli: qty * 1000,
      unitPriceMinor: item.priceMinor,
      discountMinor: 0,
    }))
    const gross = body.reduce((sum, line) => sum + (line.qtyMilli / 1000) * line.unitPriceMinor, 0)
    const discountMinor = random.next() < 0.08 ? Math.round(gross * 0.05 / PIASTRES) * PIASTRES : 0
    const total = gross - discountMinor

    const roll = random.next()
    const customer = roll > 0.6 ? random.pick(customers) : null
    let tenders: Array<{ method: string; amountMinor: number }>
    if (roll < 0.58) tenders = [{ method: 'cash', amountMinor: Math.ceil(total / (10 * PIASTRES)) * 10 * PIASTRES }]
    else if (roll < 0.74) tenders = [{ method: 'card', amountMinor: total }]
    else if (roll < 0.86) tenders = [{ method: 'wallet', amountMinor: total }]
    else if (roll < 0.94 && total > 2000) {
      const cash = Math.floor(total / 2 / PIASTRES) * PIASTRES
      tenders = [{ method: 'cash', amountMinor: cash }, { method: 'card', amountMinor: total - cash }]
    } else tenders = [{ method: 'credit', amountMinor: total }]

    const needsCustomer = tenders.some(({ method }) => method === 'credit')
    const buyer = customer ?? (needsCustomer ? random.pick(customers) : null)

    try {
      const sale = await call<{ id: string; lines: Array<{ id: string; qtyMilli: number }> }>('POST', '/sales', session, {
        requestId: requestId(),
        customerId: buyer?.id ?? null,
        discountMinor,
        lines: body,
        tenders,
      })
      sold.push(sale)
      if (sold.length % 37 === 0 && offset > 1) await call('POST', `/sales/${sale.id}/void`, session)
    } catch (error) {
      // A shelf running out in the middle of a day is part of the story, not a failure.
      if (!String(error).includes('STOCK_') && !String(error).includes('CREDIT_') && !String(error).includes('LOT_')) throw error
    }
  }

  for (let offset = HISTORY_DAYS; offset >= 0; offset--) {
    const today = offset === 0
    if (offset % 10 === 0) console.error(`${offset} days left, ${sold.length} sales so far`)
    clock = dayAt(offset, today ? Math.min(9, new Date().getHours()) : 9).getTime()
    owner = await login(DEMO_LOGIN.username, DEMO_LOGIN.password)
    const cashier = today ? owner : await login('sara', STAFF_PASSWORD)

    await call('POST', '/shifts', cashier, { openingCashMinor: 500 * PIASTRES })

    // Business grows through the quarter, and Friday is the quiet day.
    const weekday = dayAt(offset, 12).getDay()
    const growth = 1 + (HISTORY_DAYS - offset) / HISTORY_DAYS
    // Sessions last twelve hours, so the working day ends inside one.
    const lastHour = today ? Math.min(new Date().getHours(), 20) : 20
    const visits = Math.round(random.int(6, 11) * growth * (weekday === 5 ? 0.6 : 1) * (today ? Math.max(lastHour - 8, 1) / 12 : 1))

    for (let visit = 0; visit < visits; visit++) {
      clock += Math.round(((lastHour - 9) * 3_600_000) / Math.max(visits, 1))
      await sell(cashier, offset)
    }

    const recent = sold.at(-1)
    if (recent && offset % 3 === 1 && offset > 1) {
      const line = recent.lines[0]!
      await call('POST', `/sales/${recent.id}/return`, cashier, {
        requestId: requestId(),
        method: 'cash',
        reason: 'مرتجع من العميل',
        lines: [{ saleLineId: line.id, qtyMilli: Math.min(line.qtyMilli, 1000) }],
      }).catch(() => undefined)
    }

    if (offset % 4 === 2) {
      await call('POST', '/shifts/current/cash', cashier, { kind: 'out', amountMinor: random.int(5, 30) * 10 * PIASTRES, reason: random.pick(['مصروفات نظافة', 'بوفيه', 'توصيل طلبات']) })
    }
    if (offset % 9 === 4) {
      const customer = random.pick(customers)
      await call('POST', `/customers/${customer.id}/receipts`, cashier, { amountMinor: random.int(10, 40) * 10 * PIASTRES, method: 'cash', notes: 'دفعة من الحساب' }).catch(() => undefined)
    }

    if (!today) {
      const { shift } = await call<{ shift: { id: string; expectedCashMinor: number } }>('GET', '/shifts/current', cashier)
      const difference = random.next() < 0.1 ? random.int(-3, 2) * 5 * PIASTRES : 0
      await call('POST', `/shifts/${shift.id}/close`, cashier, { countedCashMinor: Math.max(shift.expectedCashMinor + difference, 0), notes: difference ? 'فرق عد الدرج' : null })
    }

    // Cash paid out belongs to the shift that holds it, so the office pays once the till has closed.
    if (offset % 7 === 6) {
      // Every supplier delivers in turn, so the shelves stay stocked through the quarter.
      const list = [...suppliers.values()]
      const supplier = list[Math.floor(offset / 7) % list.length]!
      const chosen = items.filter(({ brand, slow, lean }) => supplier.brands.includes(brand) && !slow && !lean)
      await buy(supplier.id, chosen, offset, 4, random.pick([0, 0.5, 1]))
    }
    if (offset === 40) {
      const lines = SHORT_DATED.map(([name, qty, days]) => {
        const item = items.find((candidate) => candidate.name === name)!
        return { ...purchaseLine(item, qty, offset), expiryDate: dateIn(days) }
      })
      const purchase = await call<{ id: string }>('POST', '/purchases', owner, { kind: 'invoice', supplierId: [...suppliers.values()][3]!.id, warehouseId: 'main', supplierReference: 'INV-SHORT', notes: 'توريد بصلاحية قصيرة', lines })
      await call('POST', `/purchases/${purchase.id}/post`, owner)
    }
    if (offset % 15 === 3) {
      const supplier = random.pick([...suppliers.values()])
      await call('POST', `/suppliers/${supplier.id}/payments`, owner, { amountMinor: random.int(4, 16) * 250 * PIASTRES, method: random.pick(['cash', 'bank', 'cheque']), reference: `PAY-${random.int(1000, 9999)}`, notes: 'سداد جزء من الحساب' })
    }
  }

  // Stock work and orders that a real week would leave behind.
  clock = Date.now() - 20 * 60_000
  owner = await login(DEMO_LOGIN.username, DEMO_LOGIN.password)
  const lineOf = (item: Item, qtyMilli: number, extra: object = {}) => ({ variantId: item.variantId, unitId: item.unitId, qtyMilli, ...extra })
  const postStock = async (body: object) => {
    const document = await call<{ id: string }>('POST', '/stock/documents', owner, body)
    await call('POST', `/stock/documents/${document.id}/post`, owner)
  }
  const stocked = (name: string) => items.find((item) => item.name === name)!

  await postStock({ kind: 'adjustment', warehouseId: 'main', reason: 'damage', notes: 'عبوات تالفة أثناء النقل', lines: [lineOf(stocked('شاش طبي معقم'), -2000)] })
  await postStock({ kind: 'transfer', warehouseId: 'main', toWarehouseId: branch.id, reason: null, notes: 'تزويد مخزن الفرع', lines: [lineOf(stocked('كمامات طبية عبوة 50'), 5000), lineOf(stocked('كحول طبي 70% 250 مل'), 6000)] })
  await call('POST', '/stock/documents/count-sheet', owner, { warehouseId: 'main', categoryId: categories.get('حساسية') })

  const pharmacySupplier = [...suppliers.values()][0]!
  const orderItems = items.filter(({ brand }) => pharmacySupplier.brands.includes(brand)).slice(0, 4)
  const order = await call<{ id: string; lines: Array<{ id: string; variantId: string }> }>('POST', '/purchase-orders', owner, {
    supplierId: pharmacySupplier.id,
    warehouseId: 'main',
    expectedDate: dateIn(4),
    notes: 'طلبية الأسبوع',
    lines: orderItems.map((item) => ({ variantId: item.variantId, unitId: item.unitId, qtyMilli: 60_000, unitCostMinor: item.costMinor })),
  })
  await call('POST', `/purchase-orders/${order.id}/open`, owner)
  const received = await call<{ id: string }>('POST', '/purchases', owner, {
    kind: 'invoice',
    supplierId: pharmacySupplier.id,
    warehouseId: 'main',
    orderId: order.id,
    supplierReference: `INV-${random.int(10000, 99999)}`,
    lines: order.lines.slice(0, 2).map((line) => {
      const item = items.find(({ variantId }) => variantId === line.variantId)!
      return purchaseLine(item, 30, 0, line.id)
    }),
  })
  await call('POST', `/purchases/${received.id}/post`, owner)
  await call('POST', '/purchase-orders', owner, {
    supplierId: [...suppliers.values()][2]!.id,
    warehouseId: 'main',
    expectedDate: dateIn(7),
    notes: 'مسودة لم تُرسل بعد',
    lines: items.filter(({ brand }) => brand === 'نوفا هيلث').slice(0, 3).map((item) => ({ variantId: item.variantId, unitId: item.unitId, qtyMilli: 24_000, unitCostMinor: item.costMinor })),
  })

  clock = dayAt(7, 23).getTime()
  await call('POST', '/backups', await login(DEMO_LOGIN.username, DEMO_LOGIN.password))
  clock = Date.now()
  await call('POST', '/backups', await login(DEMO_LOGIN.username, DEMO_LOGIN.password))

  console.log(`Seeded ${items.length} items, ${customers.length} customers and ${sold.length} sales over ${HISTORY_DAYS} days.`)
  await db.destroy()
  return { recoveryCode: onboarding.recoveryCode }
}

if (process.argv[1]?.endsWith('demo-seed.mts')) {
  const { DEMO_PATH, DEMO_KEY, DEMO_BACKUPS } = process.env
  const { recoveryCode } = await seedDemo({ path: DEMO_PATH!, hexKey: DEMO_KEY!, backupsDir: DEMO_BACKUPS! })
  console.log(recoveryCode)
}

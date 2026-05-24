// Repairs Vietnamese diacritics on the 10 Zalo-imported rooms after an
// earlier code path lost UTF-8 (every diacritic became `?`).
//
// Run: node pipeline/scripts/repair-zalo-utf8.mjs [<db-path>]
// Default db-path = backend/data/db.sqlite
//
// Keyed by pipeline_source_map.source_key so it works on any DB (host or
// inside the Docker container) regardless of the per-DB room_id.

import Database from 'better-sqlite3'
import path from 'node:path'
import process from 'node:process'

const dbPath = process.argv[2] || path.join('backend', 'data', 'db.sqlite')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const CONTACT_NAME = 'Anh Hiệp'
const CONTACT_PHONE = '0978618337'
const CONTACT_ZALO = '0978618337'

const RULES_DEFAULT = { maxPeople: 2, pets: false, vehicles: 'xe máy', minMonths: 6 }
const RULES_WITH_CAR = { maxPeople: 2, pets: false, vehicles: 'xe máy, ô tô', minMonths: 6 }

// Image backfill: a few rooms had empty image arrays in the host DB after
// an earlier pipeline run. Live Docker images for the same source_keys are
// preserved here so the repair leaves every room with > 0 images. We only
// apply these if the row's current images_json is empty.
const IMAGE_BACKFILL = {
  'zalo:tro365-team1:2026-05-21:tr223-mau-luong-p305-p405': [
    '/uploads/2ded516152b0addf08a70a55.jpg',
    '/uploads/776bf5c12ecb2f053dccc2a0.jpg',
    '/uploads/cff344a5506a7a82b83e9957.jpg',
    '/uploads/f182c8a36d95cfd3ba9cc194.jpg',
    '/uploads/3799de906123d12ae9badb60.jpg',
    '/uploads/bc0f8c196140eba41ad47ba1.jpg',
    '/uploads/9096adc5946dab0fd6498c95.jpg',
    '/uploads/4789e3d6eb9e5f5b3610d2b2.jpg',
  ],
  'zalo:tro365-team1:2026-05-21:tr225-dinh-thon': [
    '/uploads/4789e3d6eb9e5f5b3610d2b2.jpg',
    '/uploads/d53458911488ae7656a52b20.jpg',
    '/uploads/399f43e81c895cc2f8465c94.jpg',
    '/uploads/5b05ad2700a8fd69a2982be2.jpg',
    '/uploads/66bb4fa0d19593440cd3117f.jpg',
    '/uploads/622003878b6ce2256244f3cf.jpg',
    '/uploads/2b5be6ef8a817a25da0d6fe6.jpg',
    '/uploads/47899e095b479f686e279d5f.jpg',
  ],
  'zalo:tro365-team1:2026-05-21:tr227-truong-chinh': [
    '/uploads/7571f4782d3558415580a1a2.jpg',
    '/uploads/9cabd1a9757d37a577e32434.jpg',
    '/uploads/45e6b9605ea4b9cc2e5e2a4b.jpg',
    '/uploads/34ed05b51cdec970ba306a33.jpg',
    '/uploads/7aa771541b12ce2cc1095b81.jpg',
    '/uploads/3799de906123d12ae9badb60.jpg',
    '/uploads/bc0f8c196140eba41ad47ba1.jpg',
  ],
  'zalo:tro365-team1:2026-05-21:tr227-dai-tu': [
    '/uploads/bacb3631ecb3ba46b05895d0.jpg',
    '/uploads/d21d248108da784151932356.jpg',
    '/uploads/2260a07cb28e4774929e1a9e.jpg',
    '/uploads/a1234216cd4f53009f9ca93f.jpg',
    '/uploads/5549d7f2e93266af5f283d59.jpg',
    '/uploads/399f43e81c895cc2f8465c94.jpg',
    '/uploads/5b05ad2700a8fd69a2982be2.jpg',
  ],
}

const FIXES = [
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr222-me-tri-ha',
    title: 'TR222 - Phòng 59/93 Mễ Trì Hạ',
    district: 'Nam Từ Liêm',
    ward: 'Mễ Trì',
    addressHint: '59/93 Mễ Trì Hạ',
    description: 'Có các phòng P401, P604, P605, P506, P510, P103, P104, diện tích khoảng 20-25m². P401 là phòng gác xép ở ngay; P506/P510 vào từ 1/6; nhóm P604, P605, P103, P104 có cửa sổ thoáng và ở ngay. Tòa có cả thang bộ và thang máy.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr222-nguyen-hoang-office',
    title: 'TR222 - Sàn văn phòng tầng 8 Nguyễn Hoàng',
    district: 'Nam Từ Liêm',
    ward: 'Mỹ Đình 2',
    addressHint: 'Số 63A phố Nguyễn Hoàng, Mỹ Đình 2',
    description: 'Sàn văn phòng/MBKD tầng 8 tại mặt phố Nguyễn Hoàng, đối diện BV Quốc tế Dolife, gần ĐH Thương Mại và bến xe Mỹ Đình. Tòa nhà 8 tầng 1 hầm, phù hợp làm văn phòng hoặc mặt bằng kinh doanh. Thanh toán 3 cọc 2 hoặc 6 cọc 1, ưu tiên hợp đồng lâu dài.',
    rules: RULES_WITH_CAR,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr223-me-tri-thuong-p401',
    title: 'TR223 - Studio P401 Mễ Trì Thượng',
    district: 'Nam Từ Liêm',
    ward: 'Mễ Trì',
    addressHint: 'Ngõ 230/21/15 số nhà 20 Mễ Trì Thượng',
    description: 'P401 studio diện tích lớn, đang trống và có thể ở luôn. Nhà trong ngõ Mễ Trì Thượng, cách khoảng 80m ra đường ô tô. Phù hợp người cần phòng rộng, có khu sinh hoạt riêng.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr223-mieu-dam-studios',
    title: 'TR223 - Studio Miếu Đầm trục 01',
    district: 'Nam Từ Liêm',
    ward: 'Mễ Trì',
    addressHint: '116/51/4 Miếu Đầm, Nam Từ Liêm',
    description: 'Cụm studio tại 116/51/4 Miếu Đầm, cách khoảng 10m ra đường ô tô tránh và gần Đại Lộ Thăng Long. Các phòng trống gồm P101, P201, P302, P401; trục 01 được tách riêng theo nhóm ảnh trong tin Zalo.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr223-mau-luong-p503',
    title: 'TR223 - P503 Studio Mậu Lương',
    district: 'Hà Đông',
    ward: 'Kiến Hưng',
    addressHint: 'Lô 3,4,5 Liền Kề 9, Khu đấu giá đất Mậu Lương, Kiến Hưng',
    description: 'P503 studio trống sẵn tại khu đấu giá đất Mậu Lương, Kiến Hưng. Tòa có thang máy, phù hợp khách cần phòng khép kín khu Hà Đông.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr223-mau-luong-p305-p405',
    title: 'TR223 - P305/P405 Studio Mậu Lương',
    district: 'Hà Đông',
    ward: 'Kiến Hưng',
    addressHint: 'Lô 3,4,5 Liền Kề 9, Khu đấu giá đất Mậu Lương, Kiến Hưng',
    description: 'P305 và P405 studio trống sẵn tại khu đấu giá đất Mậu Lương, Kiến Hưng. Hai phòng cùng tòa với P503, phù hợp khách tìm studio có thang máy ở Hà Đông.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr225-dinh-thon',
    title: 'TR225 - Phòng full nội thất 97 Đình Thôn',
    district: 'Nam Từ Liêm',
    ward: 'Mỹ Đình 1',
    addressHint: '97 Đình Thôn',
    description: 'Phòng full nội thất trống sẵn tại 97 Đình Thôn, chính chủ, cạnh chợ và chỉ một ngoặt ra mặt đường. Tòa thang bộ 4 tầng, phù hợp khách cần ở khu Mỹ Đình - Đình Thôn.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr227-truong-chinh',
    title: 'TR227 - Studio Trường Chinh 201/202/203',
    district: 'Đống Đa',
    ward: 'Khương Thượng',
    addressHint: 'Trường Chinh, ngõ 554/127 thông sang hồ Khương Thượng',
    description: 'Studio tại ngõ 554/127 Trường Chinh, thông sang hồ Khương Thượng. Hiện trống các phòng 201, 202, 203. Tòa có thang máy, hợp khách cần khu Đống Đa - Trường Chinh.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr227-dai-tu',
    title: 'TR227 - P202/P403/P404 ngõ 158 Đại Từ',
    district: 'Hoàng Mai',
    ward: 'Đại Kim',
    addressHint: 'Số 11 ngõ 158 Đại Từ',
    description: 'P202 dạng 1K1N, P403 và P404 dạng studio tại số 11 ngõ 158 Đại Từ. Tòa có thang máy, khu phơi đồ tầng 8. Phù hợp khách tìm phòng khu Đại Từ - Đại Kim.',
    rules: RULES_DEFAULT,
  },
  {
    sourceKey: 'zalo:tro365-team1:2026-05-21:tr223-mieu-dam-studios-truc02',
    title: 'TR223 - Studio Miếu Đầm trục 02',
    district: 'Nam Từ Liêm',
    ward: 'Mễ Trì',
    addressHint: '116/51/4 Miếu Đầm, Nam Từ Liêm',
    description: 'Cụm studio tại 116/51/4 Miếu Đầm, cùng nhóm phòng P101, P201, P302, P401. Trục 02 được tách thành listing riêng để khách xem ảnh theo đúng nhóm trục trong tin Zalo.',
    rules: RULES_DEFAULT,
  },
]

const findRoomId = db.prepare(
  `SELECT room_id FROM pipeline_source_map WHERE source_key = ?`
)
const findRoom = db.prepare(`SELECT id, images_json FROM rooms WHERE id = ?`)
const updateRoom = db.prepare(`
  UPDATE rooms SET
    title = @title,
    district = @district,
    ward = @ward,
    address_hint = @addressHint,
    description = @description,
    rules_json = @rulesJson,
    contact_name = @contactName,
    contact_phone = @contactPhone,
    contact_zalo = @contactZalo,
    updated_at = @updatedAt
  WHERE id = @id
`)
const updateImages = db.prepare(
  `UPDATE rooms SET images_json = @imagesJson, updated_at = @updatedAt WHERE id = @id`
)
const insertAudit = db.prepare(
  `INSERT INTO audit (at, kind, payload_json) VALUES (?, ?, ?)`
)

const now = Date.now()
let touched = 0
const report = []

const tx = db.transaction(() => {
  for (const fix of FIXES) {
    const mapRow = findRoomId.get(fix.sourceKey)
    if (!mapRow) {
      report.push({ sourceKey: fix.sourceKey, status: 'missing-source-map' })
      continue
    }
    const room = findRoom.get(mapRow.room_id)
    if (!room) {
      report.push({ sourceKey: fix.sourceKey, status: 'missing-room', roomId: mapRow.room_id })
      continue
    }
    let imageCount = 0
    try { imageCount = JSON.parse(room.images_json || '[]').length } catch { imageCount = 0 }
    let backfilled = false
    if (imageCount === 0 && IMAGE_BACKFILL[fix.sourceKey]) {
      const urls = IMAGE_BACKFILL[fix.sourceKey]
      updateImages.run({ id: room.id, imagesJson: JSON.stringify(urls), updatedAt: now })
      imageCount = urls.length
      backfilled = true
    }
    updateRoom.run({
      id: room.id,
      title: fix.title,
      district: fix.district,
      ward: fix.ward,
      addressHint: fix.addressHint,
      description: fix.description,
      rulesJson: JSON.stringify(fix.rules),
      contactName: CONTACT_NAME,
      contactPhone: CONTACT_PHONE,
      contactZalo: CONTACT_ZALO,
      updatedAt: now,
    })
    touched++
    report.push({
      sourceKey: fix.sourceKey,
      status: 'ok',
      roomId: room.id,
      images: imageCount,
      backfilledImages: backfilled,
    })
  }
  insertAudit.run(now, 'pipeline.zalo-web.utf8-repair', JSON.stringify({ touched, report }))
})
tx()

db.pragma('wal_checkpoint(TRUNCATE)')
db.close()

console.log(JSON.stringify({ dbPath, touched, report }, null, 2))

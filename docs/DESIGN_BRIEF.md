# Ở Đây Nè — Design Brief

> Tài liệu này dùng để chuyển giao cho người thiết kế (logo + UI/UX) làm lại
> giao diện. Bao gồm: định vị sản phẩm, mục tiêu, đối tượng, sơ đồ trang, các
> chức năng cần có trên từng trang, brand tokens hiện tại và yêu cầu deliverables.

---

## 1. Tổng quan sản phẩm

**Ở Đây Nè** là nền tảng tìm phòng trọ ở Hà Nội theo phong cách **quẹt như
Tinder** — người thuê thấy nhà chỉ trong vài giây, không phải lướt danh sách
dài dằng dặc như các trang rao vặt truyền thống.

- **Tagline hiện tại:** *"Quẹt là thấy nhà — Hà Nội của bạn"*
- **Khẩu vị thương hiệu:** ấm áp, gần gũi, đời thường (cream + leaf green +
  terracotta), không khô khan như fintech, không quá trẻ con như app hẹn hò
- **Khác biệt với chotot/batdongsan:**
  - Quẹt nhanh, một phòng mỗi lúc → ra quyết định nhanh
  - "Hợp gu" thay vì "Lưu" — gợi cảm giác matching, có duyên với phòng
  - Phòng được **xác minh** chủ + địa chỉ + PCCC → an toàn cho người thuê
  - Cộng đồng đóng góp ảnh thật, review thật

---

## 2. Đối tượng người dùng

| Persona | Mục tiêu | Trang chính dùng |
|---|---|---|
| **Người tìm phòng** (sinh viên, người đi làm, người mới ra Hà Nội) | Tìm phòng phù hợp gu (giá, khu vực, tiện nghi) nhanh nhất | Quẹt → Chi tiết → Hợp gu |
| **Chủ trọ** (landlord) | Đăng tin nhanh, theo dõi lượt xem/lượt thích, quản lý nhiều phòng | Đăng phòng → Phòng của tôi |
| **Admin / Moderator** | Duyệt ảnh người dùng đóng góp, xử lý báo cáo, xác minh chủ trọ, quản lý người dùng | Quản trị |

**Anonymous visitor** vào thẳng trang Quẹt — không cần đăng nhập trước. Login
chỉ xuất hiện khi user cần **lưu, review, đóng góp ảnh, báo cáo, đăng phòng,
hoặc thao tác chủ trọ/admin**.

---

## 3. Mục tiêu thiết kế (redesign)

1. **Logo mới** thay logo "Ở" tròn xanh hiện tại — giữ tinh thần ấm/Hà Nội/nhà,
   không đụng hàng với app hẹn hò (tránh trái tim/lửa quá lộ).
2. **Giao diện desktop tận dụng màn rộng** — hiện tại đang để cream margin
   trống ~300px hai bên trên màn 1920px. Layout 3 cột (filter | quẹt | thông
   tin) cần fit trong **1 viewport không scroll** ở 1080p+.
3. **Mobile-first cho thao tác quẹt** — trên điện thoại, gesture là chính
   (← bỏ qua · → hợp gu · ↑ chi tiết); nút bấm là phụ. Card ảnh chiếm trọn
   phần lớn màn hình.
4. **Trust + an toàn** — badge xác minh, PCCC, camera phải dễ thấy nhưng
   không lấn át nội dung phòng. Quan trọng vì user Việt rất nhạy với lừa đảo
   tin phòng giả.
5. **Văn hoá địa phương** — tone xưng hô "bạn/mình", từ vựng Việt tự nhiên
   ("quẹt", "hợp gu", "phòng còn trong stack"). Tránh tone enterprise/B2B.
6. **Đa vai trò một app** — cùng một header/footer phục vụ cả seeker, landlord
   và admin. Khác biệt bằng nav item ẩn/hiện, không bằng giao diện khác.

---

## 4. Brand tokens hiện tại (để tham khảo / kế thừa nếu muốn)

| Token | Giá trị | Vai trò |
|---|---|---|
| `leaf-500` | xanh lá đậm | CTA chính, "hợp gu", verified |
| `leaf-50/100/700` | xanh nhạt → đậm | nền badge, text accent |
| `coral-400/500` | terracotta | nút "bỏ qua", lỗi, destructive |
| `cream-50/100/200/300` | kem ấm | nền chính, card surface |
| `ink-400→900` | xám đen | text |
| Font display | `Fraunces` (serif) | tiêu đề, giá tiền, stamp "Hợp gu" |
| Font body | `Inter` mặc định | nội dung, form |
| Bo góc | `rounded-2xl` (16px), `rounded-[28px]` (card lớn) | mềm, gần gũi |
| Shadow | `shadow-soft`, `shadow-card` | layered, không quá deep |

**Người thiết kế có thể giữ palette này hoặc đề xuất mới** — miễn là vẫn ấm,
gần gũi, không "kiểu" hẹn hò hay fintech.

---

## 5. Logo brief

**Tinh thần cần truyền tải:**
- Ngôi nhà / không gian sống
- Hà Nội (có thể gợi qua nóc nhà cổ, phố cổ, lá bàng, hoa sữa — tinh tế,
  không tả thực)
- Gần gũi, ấm — không corporate, không tech-feel cứng
- Liên quan đến **quẹt / matching** ở mức gợi ý (không bắt buộc trái tim)

**Yêu cầu kỹ thuật:**
- Hoạt động ở **32px** (favicon) và **160px+** (header tablet/desktop)
- SVG, một màu chính (leaf-500) + biến thể trắng đặt trên nền màu
- Có thể có wordmark đi kèm: **"Ở Đây Nè"** (font Fraunces hoặc font tương đương)
- Tránh: chữ "Ở" trong vòng tròn (đang dùng — quá giống logo bank), trái tim
  quá lộ, ngôi nhà tả thực kiểu real estate

---

## 6. Sơ đồ trang & chức năng

### 6.1 Trang Quẹt (`/` — Discover) · **trang quan trọng nhất**

**Mục đích:** quẹt phòng nhanh, ra quyết định nhanh.

**Cấu trúc 3 cột (desktop ≥ lg):**

```
┌─────────────┬─────────────────────┬───────────────────┐
│ Bộ lọc      │  Card quẹt          │ Panel phòng đang  │
│ (sticky)    │  (stacked, 3 cards) │ quẹt (chi tiết)   │
│             │  + 3 nút action     │                   │
└─────────────┴─────────────────────┴───────────────────┘
```

**Cột giữa (Card quẹt):**
- Ảnh phòng tràn full card, thumbstrip dots ở đỉnh
- Gradient overlay đáy → text trắng nổi (title, district/ward, area, type)
- Badges: "Đã xác minh", "Nổi bật", "XX% hợp gu" (chip trắng nhỏ)
- Giá thuê lớn ở đáy card, không có nút "Chi tiết" pill (gesture vuốt lên đảm nhiệm)
- 3 nút action dưới card (Pass coral · Detail cream · Like leaf), kích thước **bằng nhau**, hierarchy bằng màu
- Gesture: vuốt ← bỏ qua, vuốt → hợp gu, vuốt ↑ chi tiết
- Empty state: "Hết phòng hợp gu hôm nay rồi" + nút "Dọn lại stack"

**Cột trái (Bộ lọc):**
- Tìm kiếm text
- Section gấp được: Khu vực, Giá/tháng, Loại phòng, Diện tích tối thiểu, Tiện nghi, Sắp xếp
- Mỗi section khi đã chọn → hiển thị badge value bên cạnh tên section
- Nút Đặt lại bộ lọc

**Cột phải (Panel "Phòng bạn đang quẹt"):**
- Header: anchor "← Phòng bạn đang quẹt" + chip "XX% hợp gu"
- Hero cost: Giá thuê (lớn) + Cọc (nhỏ) + "Cập nhật X giờ trước"
- **Phí dịch vụ**: grid 2 cột — Điện/Nước/Internet/Dịch vụ/Gửi xe
- **Tiện nghi**: chip row (tối đa 8 + "+N")
- **Vị trí**: ward/district + addressHint
- **Vì sao phù hợp**: 2 bullet ngắn
- **Safety chips**: PCCC, Camera, Đã xác minh
- CTA "Xem chi tiết & liên hệ"

**Mobile (<md):**
- Header gọn (chỉ logo + nút bộ lọc)
- Card ảnh chiếm gần full màn hình, ratio 3/4 → 4/5
- Bộ lọc trong slide-up sheet
- Bottom tab bar 4–5 tab

---

### 6.2 Chi tiết phòng (`/room/:id` — RoomDetail)

- **Gallery ảnh hero**: arrows, thumbstrip, badge overlays (verified, featured, report count)
- **Tiêu đề + giá + cọc + mô tả**
- **Grid tiện nghi đầy đủ**: chia 2 nhóm (có / không có)
- **Bảng phí dịch vụ**: điện, nước, internet, dịch vụ, gửi xe
- **Quy định**: số người tối đa, thú cưng, xe cộ, thời gian thuê tối thiểu
- **Card vị trí**: ward/district + addressHint + link OpenStreetMap
- **Ảnh cộng đồng đóng góp**: state Chờ duyệt (chỉ owner + admin thấy) / Đã duyệt
- **Reviews**: rating sao + text + thời gian, có form thêm review (login)
- **Card liên hệ**: nút hiện số điện thoại (mặc định ẩn — privacy), Zalo nếu có
- **Sticky CTA mobile** (đè lên tab bar): giá + nút Hợp gu/Bỏ + Hiện SĐT
- **Form inline**: Báo cáo, Đóng góp ảnh (URL), Review
- **Safety tips sidebar**: card nhỏ nhắc xem ban ngày, không chuyển cọc trước khi ký giấy

---

### 6.3 Hợp gu (`/saved` — Saved/Shortlist)

- **Khi anonymous**: GatedScreen — emoji + tiêu đề + 3-4 lợi ích + CTA Đăng nhập
- **Khi đã login**: grid 2–3 cột room cards
  - Thumbnail ảnh + title + district + type + area + giá + tiện nghi top 3 + cập nhật
  - Nút trash (bỏ hợp gu) + nút xem chi tiết
- **Empty state**: gợi user quay lại Quẹt

---

### 6.4 Đăng phòng (`/post` — Post listing)

- **Khi anonymous**: GatedScreen với lợi ích đăng nhanh, xác minh, thống kê
- **Khi đã login**: form nhiều section
  1. **Thông tin cơ bản**: tiêu đề, loại phòng, diện tích, giá, cọc, quận, phường, gợi ý địa chỉ, mô tả
  2. **Ảnh phòng**: input URL + nút thêm, grid preview ảnh có nút xoá
  3. **Tiện nghi**: chip toggle (có thể chọn nhiều)
  4. **Phí dịch vụ**: grid input (điện, nước, internet, dịch vụ, gửi xe)
  5. **Quy định**: input maxPeople, switch thú cưng, input vehicles, input minMonths
  6. **Liên hệ** (sidebar/right): tên, SĐT, Zalo
- **Success state**: card xác nhận + link xem listing + link Phòng của tôi
- Tài khoản tự động promote seeker → landlord khi đăng phòng đầu tiên

---

### 6.5 Phòng của tôi (`/owner` — Landlord dashboard)

- **Summary cards header**: tổng phòng / đang hoạt động (xanh) / đã đóng (coral) / tổng views / tổng likes
- **Danh sách phòng dạng row**: thumbnail + title + status badge (active/closed/hidden/pending) + featured/verified badges + views/likes/updated + nút đóng/mở + nút xem chi tiết
- **CTA "Đăng phòng mới"** ở header

---

### 6.6 Quản trị (`/admin` — Admin dashboard)

5 tabs:
1. **Stats**: grid 6 card — active users, active rooms, hidden/closed rooms, flagged rooms, open reports, pending photos
2. **Rooms (Phòng)**: bảng sortable — tiêu đề/ID, khu vực, giá, status, lượt báo cáo, bulk action: ẩn/hiện, feature toggle, verify toggle, xoá
3. **Reports (Báo cáo)**: card list — reason badge (tin giả, sai giá, v.v.), detail text, room ID link, nút "Đã xử lý", relative timestamp
4. **Photos (Ảnh)**: grid 3 cột ảnh đóng góp chờ duyệt — room ID, caption, nút Approve/Reject
5. **Users (Người dùng)**: bảng — tên, email, ID, role, status suspend, nút unsuspend/suspend, nút grant/revoke admin

---

## 7. Components dùng chung

### 7.1 AppShell (Header / Nav / Footer)

- **Header sticky (md+)**: logo home button (trái) + top nav (Quẹt, Hợp gu, Đăng, Của tôi, Quản trị nếu admin) + tên/role user + nút Đăng xuất (lg+) — hoặc nút Đăng nhập nếu anonymous
- **Bottom tab bar (mobile)**: 4–5 tab với underline active + lock dot trên tab gated
- **Footer**: ẩn trên trang Quẹt; trang khác hiện logo + © + tagline + "made in Hà Nội"

### 7.2 LoginPopup (Modal đăng nhập dùng chung)

- Modal centered (tablet+), slide-up từ đáy (mobile)
- Header branding "Chào mừng tới Ở Đây Nè" + subtitle theo intent ("Đăng nhập để lưu phòng")
- Tab kép: **Người tìm phòng** | **Chủ trọ**
- Provider buttons: Google, Facebook, Zalo (hoặc fallback demo email form nếu chưa cấu hình OAuth)
- Dev hint footer (chỉ trong demo mode)

### 7.3 GatedScreen (Gate đăng nhập)

- Card centered: emoji icon + tiêu đề + subtitle + 3–4 bullet lợi ích (emoji + text)
- CTA primary (Đăng nhập) + secondary (Quay lại)
- Optional preview tiles grid 2 cột bên dưới
- Tone variant: leaf (default) hoặc coral (admin)

### 7.4 FiltersPanel

(xem chi tiết ở phần 6.1 cột trái)

### 7.5 SwipeCard

(xem chi tiết ở phần 6.1 cột giữa)

---

## 8. Responsive breakpoints

| Breakpoint | Width | Layout Discover |
|---|---|---|
| **<md** (mobile) | <768px | 1 cột, card aspect 3/4 → 4/5, bottom tab bar, filter slide-up sheet |
| **md** (tablet) | 768–1023px | 2 cột (deck + insight rail), top nav, filter sheet |
| **lg** (laptop) | 1024–1279px | 3 cột (filter · deck · insight), card max-w-2xl |
| **xl** | 1280–1535px | 3 cột, rails to hơn, card max-w-3xl |
| **2xl** (ultra-wide) | ≥1536px | 3 cột mở rộng, main width 1600px, card max-w-4xl, rails 19rem/24rem |

**Yêu cầu redesign:** mobile + 2xl đều phải đẹp; tránh wasted space ở màn lớn.

---

## 9. Nguyên tắc UX cần giữ

1. **Anonymous-first** — Quẹt không bao giờ wall login. Login chỉ pop khi user
   ấn tính năng cần auth.
2. **Vietnamese tone tự nhiên** — không dịch máy móc. Ví dụ: "Hợp gu" tốt hơn
   "Lưu", "Quẹt là thấy nhà" tốt hơn "Tìm phòng dễ dàng".
3. **Gesture là chính trên mobile** — buttons phụ trợ. Trên desktop, keyboard
   shortcut song hành với buttons (← → quẹt · Enter chi tiết).
4. **Trust signals dễ thấy** — Đã xác minh, PCCC, Camera, đánh giá thật
   của người đã thuê.
5. **No emoji-as-icon** — dùng SVG icon (Lucide style), emoji chỉ dùng cho
   amenity chips và trang trí gating screen.
6. **Touch target ≥44px** — đặc biệt 3 nút action.
7. **Reduce horizontal scroll** — desktop ultra-wide phải hiển thị hết
   filter + thông tin trong 1 viewport, không cuộn dọc cũng không cuộn ngang.

---

## 10. Deliverables mong muốn từ designer

### Logo

- [ ] Primary logo (full color, dùng trên cream background)
- [ ] Inverted logo (cho dark / coloured backgrounds)
- [ ] Favicon 32px + 16px (đơn giản hoá)
- [ ] Logo monochrome (1 màu) cho footer/email
- [ ] File: SVG + PNG @1x/@2x/@3x
- [ ] Brand guideline 1-2 trang: clearance, do/don't

### UI

- [ ] Figma file đầy đủ với:
  - Trang Quẹt (mobile 375px, tablet 768px, desktop 1440px, ultra-wide 1920px)
  - Trang Chi tiết phòng (mobile + desktop)
  - Trang Hợp gu (gated state + logged-in state)
  - Trang Đăng phòng (gated + full form)
  - Trang Phòng của tôi
  - Trang Quản trị (5 tabs)
  - LoginPopup (mobile slide-up + desktop centered)
  - GatedScreen
  - Empty/loading/error states cho từng trang
- [ ] Design system file:
  - Color tokens (light mode bắt buộc; dark mode optional)
  - Typography scale
  - Spacing scale
  - Component library: button, input, chip, card, modal, badge, tab
  - Iconography (chọn 1 set thống nhất, ví dụ Lucide hoặc custom Vietnamese-feel)
- [ ] Prototype có interaction cho luồng quẹt + chi tiết (Figma prototyping)
- [ ] Asset xuất sẵn cho dev: SVG icons, hình minh hoạ empty state, illustration cho GatedScreen

### Optional nice-to-have

- [ ] Bộ icon riêng cho 11 quận Hà Nội (gợi ý vị trí trực quan)
- [ ] Illustration "Hà Nội" decorative — nóc nhà phố cổ, gánh hàng rong, cây bàng, v.v., dùng trang trí footer/empty state
- [ ] Animated mascot nhỏ (nếu phù hợp brand)

---

## 11. Tech stack & ràng buộc kỹ thuật

(Cho designer biết để chọn solution implementable)

- **Frontend:** React + Vite + TypeScript + **Tailwind CSS**
- **Không có animation library nặng** — dùng CSS transition + transform là chính
- **Icon:** Lucide-style inline SVG (24px viewBox, stroke 1.75)
- **Font:** Google Fonts (Fraunces + Inter) hoặc đề xuất font tương đương open-source
- **Image hosting:** ban đầu chỉ nhận URL ảnh, chưa upload trực tiếp
- **Phải accessible**: WCAG AA contrast, focus visible, alt text, ARIA labels

---

## 12. Mốc tham khảo (cảm hứng)

- **Tinder / Hinge** — swipe deck mechanic, card stack
- **Airbnb** — trust signals, listing detail, photo gallery layout
- **Notion / Linear** — clean typography, minimal chrome
- **Mubi / Letterboxd** — warm content-forward palette
- **Đặc thù Việt Nam**: chợ tốt, batdongsan.com.vn (để biết user expectation
  về trang thuê nhà, nhưng **không bắt chước style cũ kỹ của họ**)

---

*Mọi câu hỏi về scope, brand, hoặc tech ràng buộc — liên hệ trực tiếp với
chủ project trước khi bắt tay vào file Figma.*

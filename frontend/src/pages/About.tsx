import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { goDiscover, goPost, goSaved } from '../lib/router'

export function AboutPage() {
  const auth = useAuth()

  return (
    <div className="space-y-8">
      <Hero auth={auth} />
      <HowItWorks />
      <SafetySection />
      <FaqSection />
      <CtaBanner auth={auth} />
    </div>
  )
}

function Hero({ auth }: { auth: ReturnType<typeof useAuth> }) {
  return (
    <section className="card-soft relative overflow-hidden p-6 sm:p-10">
      <div className="absolute inset-0 -z-10 dot-grid opacity-50" />
      <p className="eyebrow inline-flex items-center gap-1.5">
        <Icon.Compass size={11} className="text-leaf-500" /> Về Ở Đây Nè
      </p>
      <h1 className="mt-1 max-w-2xl font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        Tìm phòng trọ Hà Nội theo cách <span className="text-leaf-700">"quẹt là thấy nhà"</span>.
      </h1>
      <p className="mt-3 max-w-2xl text-ink-700">
        Không còn cuộn 30 trang chợ tốt mỗi tối. Bạn nhận phòng đề xuất từng cái một,
        quẹt phải nếu hợp gu, vuốt lên để xem chi tiết và liên hệ xem phòng. Mọi tin
        đều có ảnh thật, có chủ thật, và được cộng đồng giám sát.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={goDiscover} className="btn-leaf btn-pill">
          <Icon.Compass size={14} /> Bắt đầu quẹt phòng
        </button>
        {!auth.user && (
          <button onClick={() => auth.openPopup('about')} className="btn-outline btn-pill">
            <Icon.LogOut size={14} className="rotate-180" /> Đăng nhập
          </button>
        )}
        {auth.user && (
          <button onClick={goSaved} className="btn-outline btn-pill">
            <Icon.HeartFilled size={14} /> Xem Hợp gu của tôi
          </button>
        )}
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: <Icon.Sliders size={20} />,
      title: 'Đặt bộ lọc',
      body: 'Quận, ngân sách, diện tích, tiện nghi bắt buộc — chỉ phòng khớp mới vào stack quẹt.',
    },
    {
      icon: <Icon.HeartFilled size={20} />,
      title: 'Quẹt phải = Hợp gu',
      body: 'Quẹt một lần là phòng lưu vào sổ Hợp gu — không lo trôi mất giữa stack.',
    },
    {
      icon: <Icon.Phone size={20} />,
      title: 'Gọi chủ phòng',
      body: 'Bấm hiện số là gọi/ Zalo trực tiếp. Không có trung gian, không có môi giới ẩn.',
    },
    {
      icon: <Icon.Shield size={20} />,
      title: 'Phòng được xác minh',
      body: 'Tin gắn nhãn "Đã xác minh" được admin kiểm chủ, địa chỉ và PCCC trước khi lên top.',
    },
  ]
  return (
    <section>
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Cách hoạt động</h2>
      <p className="mt-1 text-sm text-ink-500">Bốn bước, không tài khoản cũng vẫn quẹt được. Đăng nhập chỉ khi cần lưu hoặc đăng tin.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.title} className="card-soft">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-2xl bg-leaf-50 text-leaf-700 ring-1 ring-leaf-100">
                {s.icon}
              </span>
              <span className="font-mono text-[11px] font-bold text-ink-400">0{i + 1}</span>
            </div>
            <p className="mt-3 font-display text-lg font-semibold text-ink-900">{s.title}</p>
            <p className="mt-1 text-sm text-ink-500">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function SafetySection() {
  const tips = [
    {
      title: 'Luôn xem trực tiếp ban ngày',
      body: 'Phòng có cửa sổ ban đêm trông khác hẳn ban ngày. Đi xem vào buổi sáng hoặc chiều đầy nắng — sẽ thấy mốc, độ thoáng, hàng xóm thật.',
    },
    {
      title: 'Đừng chuyển cọc trước khi ký giấy',
      body: 'Không có hợp đồng = không có cọc. Đặt cọc bằng giấy viết tay tối thiểu, ghi rõ ngày trả phòng, mức trừ tiền và số điện thoại hai bên.',
    },
    {
      title: 'Cảnh giác giá thấp bất thường',
      body: 'Nếu phòng rẻ hơn 30%+ so với mặt bằng cùng khu vực và cùng diện tích, khả năng cao là tin câu khách hoặc môi giới mượn ảnh phòng khác.',
    },
    {
      title: 'Kiểm tra PCCC và lối thoát',
      body: 'Phòng tầng cao, ngõ sâu cần có bình PCCC tại tầng và lối thoát thứ hai. Tin gắn nhãn "PCCC đạt chuẩn" đã được admin kiểm — vẫn nên xem tận mắt.',
    },
    {
      title: 'Không nộp giấy tờ gốc',
      body: 'Chủ trọ tử tế chỉ cần photo CCCD và bản thoả thuận. Đừng để bản gốc CMND/CCCD/bằng lái lại nhà chủ.',
    },
    {
      title: 'Gọi vào số đăng tin trước khi đi',
      body: 'Số nào tắt máy hoặc nhờ chuyển tiền giữ chỗ qua tài khoản lạ — báo cáo ngay rồi bỏ qua, đừng tiếc thời gian.',
    },
  ]
  return (
    <section>
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
        <Icon.Shield size={20} className="mr-2 inline -translate-y-px text-leaf-700" />
        An toàn cho người thuê
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        Chợ phòng trọ Hà Nội nhiều "deal hời" nhưng cũng nhiều bẫy. Những gợi ý dưới được tổng hợp từ phản ánh của cộng đồng — đọc 2 phút có thể tiết kiệm vài chục triệu cọc.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {tips.map((t) => (
          <div key={t.title} className="card-soft">
            <p className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
              <Icon.Check size={14} className="text-leaf-700" />
              {t.title}
            </p>
            <p className="mt-1 text-sm text-ink-500">{t.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-coral-50 px-4 py-3 text-sm text-coral-500 ring-1 ring-coral-100">
        <p className="inline-flex items-center gap-2 font-semibold">
          <Icon.AlertTriangle size={14} /> Phát hiện tin lừa đảo?
        </p>
        <p className="mt-1 text-coral-500/90">
          Mở chi tiết phòng, bấm "Báo cáo" và chọn lý do. Tin bị 3+ báo cáo sẽ bị admin xem xét và có thể bị ẩn hoàn toàn.
        </p>
      </div>
    </section>
  )
}

function FaqSection() {
  const items = [
    {
      q: 'Mình có cần đăng nhập để dùng không?',
      a: 'Không. Bạn quẹt và xem chi tiết phòng thoải mái khi chưa đăng nhập. Đăng nhập chỉ cần khi muốn lưu phòng (Hợp gu), đóng góp ảnh, đánh giá, báo cáo, hoặc đăng tin.',
    },
    {
      q: 'Phí đăng tin là bao nhiêu?',
      a: 'Trong giai đoạn xem trước, đăng tin miễn phí. Sau này sẽ có gói trả phí cho tin Nổi bật và xác minh nhanh, các tin tiêu chuẩn vẫn miễn phí.',
    },
    {
      q: 'Số điện thoại của mình có hiện công khai không?',
      a: 'SĐT trên tin chủ trọ chỉ hiện khi người dùng chủ động bấm "Hiện SĐT" ở trang chi tiết — và chỉ với tài khoản đã đăng nhập. Bạn cũng có thể bỏ trống Zalo nếu không muốn dùng.',
    },
    {
      q: 'Phòng đã đóng có lên lại được không?',
      a: 'Có. Vào "Phòng của tôi", chọn tin và bấm "Mở lại" — tin sẽ quay lại stack quẹt với thông tin và ảnh cũ.',
    },
    {
      q: 'Mình có thể ghép ở (share room) trên app không?',
      a: 'Được. Chọn loại phòng "Ở ghép" khi đăng tin, ghi rõ giới tính/giờ giấc mong muốn trong phần mô tả. Người tìm có thể lọc theo loại "Ở ghép" để chỉ thấy phòng kiểu này.',
    },
    {
      q: 'Khi nào tin bị admin ẩn?',
      a: 'Khi tin bị 3+ báo cáo về cùng một nội dung, hoặc admin phát hiện ảnh trùng từ trang khác, giá ảo, hoặc địa chỉ không tồn tại. Bạn vẫn xem được tin trong "Phòng của tôi" để sửa rồi mở lại.',
    },
  ]
  return (
    <section>
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Câu hỏi thường gặp</h2>
      <div className="mt-4 space-y-2">
        {items.map((it) => <FaqItem key={it.q} q={it.q} a={it.a} />)}
      </div>
    </section>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card-soft p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-display text-base font-semibold text-ink-900">{q}</span>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cream-200 transition ${open ? 'rotate-45 text-coral-500' : 'text-ink-700'}`}>
          <Icon.Plus size={14} />
        </span>
      </button>
      {open && (
        <p className="px-4 pb-4 text-sm text-ink-700">{a}</p>
      )}
    </div>
  )
}

function CtaBanner({ auth }: { auth: ReturnType<typeof useAuth> }) {
  return (
    <section className="card-soft flex flex-wrap items-center justify-between gap-3 bg-leaf-50 ring-leaf-100">
      <div>
        <p className="font-display text-xl font-semibold text-leaf-700">Sẵn sàng quẹt phòng?</p>
        <p className="text-sm text-ink-700">Phòng hợp gu đầu tiên trong Hà Nội của bạn có thể đang chờ trong stack hôm nay.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={goDiscover} className="btn-leaf btn-pill"><Icon.Compass size={14} /> Mở stack quẹt</button>
        {auth.user ? (
          <button onClick={goPost} className="btn-outline btn-pill"><Icon.Plus size={14} /> Đăng tin</button>
        ) : (
          <button onClick={() => auth.openPopup('post')} className="btn-outline btn-pill"><Icon.Plus size={14} /> Đăng tin</button>
        )}
      </div>
    </section>
  )
}

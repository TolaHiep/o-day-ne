export type RoomType = 'studio' | 'room' | 'mini_apt' | 'dorm' | 'shared'

// Fees may arrive from the manual owner form as numbers, or from importers
// (e.g. nhanhim) as pre-formatted strings like "4.000đ/số" / "120.000đ/người".
// We accept both shapes and let `formatFee` normalize at render time.
export type RoomFees = {
  electric?: number | string
  water?: number | string
  internet?: number | string
  service?: number | string
  parking?: number | string
}

export type RoomRules = {
  maxPeople?: number
  pets?: boolean
  vehicles?: string
  minMonths?: number
}

export type Rating = { avg: number | null; count: number }

export type Room = {
  id: string
  title: string
  roomType: RoomType
  priceVnd: number
  depositVnd: number
  areaM2: number
  district: string
  ward: string
  addressHint: string
  lat?: number | null
  lng?: number | null
  description: string
  amenities: string[]
  fees: RoomFees
  rules: RoomRules
  images: string[]
  contactName: string
  contactPhone: string
  contactZalo?: string | null
  verified: boolean
  status: 'active' | 'hidden' | 'closed' | 'pending'
  featured: boolean
  reports: number
  views: number
  likes: number
  ownerId?: string | null
  createdAt: number
  updatedAt: number
  availableAt?: number | null
  matchScore?: number
  rating?: Rating
  // Owner-private tag (e.g. "Nhà Nhóm", "CTV Hà"). Only present in responses
  // when the viewer is the room's owner or an admin; otherwise the field is
  // omitted from the wire payload entirely.
  source?: string | null
}

export type ContributedPhoto = {
  id: string
  roomId: string
  userId: string
  url: string
  caption?: string | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  reviewedAt?: number | null
}

export type Review = {
  id: string
  roomId: string
  userId: string
  stars: number
  text: string
  createdAt: number
  status: 'visible' | 'hidden'
}

export type Report = {
  id: string
  roomId: string
  userId: string
  reason: string
  detail?: string | null
  createdAt: number
  resolved: boolean
  resolvedAt?: number | null
}

export type User = {
  id: string
  email: string | null
  name: string
  avatar: string | null
  phone: string | null
  role: 'seeker' | 'landlord' | 'admin'
  isAdmin?: boolean
  suspendedAt?: number | null
  emailVerifiedAt?: number | null
  phoneVerifiedAt?: number | null
  verified?: boolean
  createdAt: number
}

export type AuthProviders = {
  google: { kind: 'oauth'; clientId: string; redirectUri: string } | null
  demo: { kind: 'demo' } | null
}

export type RoomFilters = {
  districts?: string[]
  roomType?: RoomType
  priceMin?: number
  priceMax?: number
  areaMin?: number
  amenities?: string[]
  sort?: 'match' | 'price-asc' | 'price-desc' | 'newest' | 'area'
  text?: string
}

export type Feedback = {
  id: string
  userId: string
  title: string
  content: string
  images: string[]
  createdAt: number
  author: {
    id: string
    name: string
    avatar: string | null
    isAdmin: boolean
  } | null
}

export type AdminStats = {
  activeUsers: number
  rooms: Record<string, number>
  flaggedRooms: number
  openReports: number
  pendingPhotos: number
}

export type AuctionType = 'request' | 'offer'
export type AuctionStatus = 'draft' | 'open' | 'closed' | 'cancelled'
export type AuctionBidStatus = 'new' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn'
export type AuctionAccessStatus = 'pending' | 'approved' | 'rejected'

export interface Auction {
  id: string
  owner_id: string
  type: AuctionType
  title: string
  public_summary: string | null
  public_description: string | null
  category: string | null
  budget_min: number | null
  budget_max: number | null
  currency: string
  required_roles: string[]
  required_skills: string[]
  expected_result: string | null
  selection_criteria: string | null
  deal_type: string | null
  readiness_level: string | null
  implementation_needs: string | null
  nda_required: boolean
  ip_mode: string | null
  linked_listing_id: string | null
  status: AuctionStatus
  ends_at: string | null
  created_at: string
  updated_at: string
}

export interface AuctionProtected {
  auction_id: string
  protected_description: string | null
  protected_links: any[]
  updated_at: string
}

export interface AuctionBid {
  id: string
  auction_id: string
  bidder_id: string
  amount: number | null
  currency: string
  proposed_deadline: string | null
  terms: string | null
  message: string | null
  deal_type: string | null
  status: AuctionBidStatus
  created_at: string
  updated_at: string
}

export interface AuctionAccessRequest {
  id: string
  auction_id: string
  requester_id: string
  message: string | null
  status: AuctionAccessStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

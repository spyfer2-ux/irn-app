export type Role = 'membro' | 'midia' | 'lider' | 'admin';
export type Status = 'pendente' | 'aprovado' | 'bloqueado';
export type Visibility = 'public' | 'members';

export interface Me {
  id: number;
  email: string;
  name: string;
  picture: string | null;
  role: Role;
  status: Status;
  phone: string | null;
  birthday: string | null;
  show_birthday: number;
  neighborhood: string | null;
  baptized: number | null;
  member_since: string | null;
  intro: string | null;
  accepted_terms_at: number | null;
  created_at: number;
}

export interface Church {
  name: string;
  short: string;
  subtitle: string;
  pastor_title: string;
  pastor_name: string;
  pastor_display: string;
  about: string;
  address: string;
  district: string;
  city: string;
  cep: string;
  maps_url: string;
  whatsapp: string;
  instagram: string;
  instagram_youth: string;
  instagram_missions: string;
  facebook: string;
  youtube_channel_id: string;
  youtube_url: string;
  email: string;
  logo_id: string;
  icon192_id: string;
  icon512_id: string;
  maskable_id: string;
}

export interface ScheduleItem {
  id: string;
  weekday: number;
  time: string;
  title: string;
  note: string;
}

export interface Cult extends ScheduleItem {
  date: string;
  at: number;
}

export interface Features {
  google: boolean;
  dev_login: boolean;
  storage: 'r2' | 'd1';
  video_upload: boolean;
  stream_ready: boolean;
  giving_public: boolean;
}

export interface Boot {
  user: Me | null;
  church: Church;
  schedule: ScheduleItem[];
  features: Features;
  now: number;
}

export interface Live {
  active: boolean;
  source: 'youtube' | 'app' | '';
  title: string;
  youtube_id: string;
  started_at: number;
  channel_id: string;
  whep_url: string;
  app_ready: boolean;
}

export interface Video {
  id: number;
  source: 'youtube' | 'upload' | 'drive';
  youtube_id: string | null;
  drive_id: string | null;
  media_id: string | null;
  poster_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  speaker: string | null;
  duration: number | null;
  visibility: Visibility;
  hidden: number;
  published_at: number;
}

export interface Photo {
  id: number;
  album_id: number | null;
  media_id: string;
  thumb_id: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  uploaded_by: number | null;
  uploader_name: string | null;
  album_title: string | null;
  created_at: number;
}

export interface Album {
  id: number;
  title: string;
  description: string | null;
  event_date: string | null;
  cover_thumb_id: string | null;
  photo_count: number;
  members_can_upload: number;
  created_at: number;
}

export interface EventItem {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  starts_at: number;
  ends_at: number | null;
  location: string | null;
  cover_id: string | null;
  visibility: Visibility;
  rsvp: number;
  capacity: number | null;
  canceled: number;
  going: number;
  my_rsvp: 'vou' | 'talvez' | 'nao' | null;
}

export interface Notice {
  id: number;
  title: string;
  body: string | null;
  image_id: string | null;
  link: string | null;
  pinned: number;
  visibility: Visibility;
  expires_on: string | null;
  created_at: number;
  author_name?: string | null;
}

export interface Word {
  id: number;
  day: string;
  title: string;
  reference: string | null;
  verse: string | null;
  body: string | null;
  author: string | null;
  image_id: string | null;
  visibility: Visibility;
}

export interface PastorMessage {
  id: number;
  day: string;
  title: string;
  reference: string | null;
  verse: string | null;
  body?: string | null;
  author: string | null;
  image_id: string | null;
  audio_id: string | null;
  audio_duration?: number | null;
  media_url: string | null;
  visibility?: Visibility;
}

export interface Sermon {
  id: number;
  title: string;
  preacher: string | null;
  reference: string | null;
  description: string | null;
  preached_on: string;
  audio_id: string | null;
  audio_url: string | null;
  youtube_id: string | null;
  cover_id: string | null;
  duration: number | null;
  visibility: Visibility;
  plays: number;
}

export type HelpKind = 'preciso' | 'ofereco';
export interface HelpPost {
  id: number;
  user_id: number | null;
  mine: boolean;
  kind: HelpKind;
  category: string;
  title: string;
  body: string | null;
  contact: string | null;
  status: 'pendente' | 'aprovado' | 'recusado' | 'resolvido';
  review_note: string | null;
  created_at: number;
  author_name: string | null;
  author_picture: string | null;
}

export interface Prayer {
  id: number;
  user_id: number | null;
  body: string;
  visibility: 'igreja' | 'lideranca';
  anonymous: number;
  answered: number;
  answered_note: string | null;
  hidden: number;
  pray_count: number;
  created_at: number;
  author_name: string | null;
  author_picture: string | null;
  prayed: number;
  mine: boolean;
}

export interface Testimony {
  id: number;
  user_id: number | null;
  title: string | null;
  body: string;
  image_id: string | null;
  video_drive_id: string | null;
  status: 'pendente' | 'aprovado' | 'recusado';
  amen_count: number;
  created_at: number;
  author_name: string | null;
  author_picture: string | null;
  amen: number;
}

export interface Campaign {
  id: number;
  title: string;
  description: string | null;
  daily_goal: string | null;
  start_date: string;
  end_date: string;
  cover_id: string | null;
  visibility: Visibility;
  members: number;
  joined: number;
  my_checkins: number;
  days_total: number;
}

export interface Ministry {
  id: number;
  type: 'celula' | 'casa_de_paz' | 'ministerio' | 'missoes';
  name: string;
  description: string | null;
  leader_name: string | null;
  schedule_note: string | null;
  neighborhood: string | null;
  address: string | null;
  contact_phone: string | null;
  instagram: string | null;
  cover_id: string | null;
  active: number;
  sort: number;
  new_requests: number;
  requested: number;
}

export interface Contribution {
  id: number;
  user_id: number | null;
  donor_name: string | null;
  person?: string | null;
  email?: string | null;
  type: string;
  amount_cents: number;
  method: string;
  given_on: string;
  receipt_id: string | null;
  note: string | null;
  status: 'informado' | 'conferido' | 'recusado';
  created_at: number;
}

export interface GivingInfo {
  restricted: boolean;
  configured: boolean;
  holder_title?: string;
  holder_name?: string;
  pix_key_type?: string;
  pix_key?: string;
  pix_name?: string;
  pix_city?: string;
  bank_name?: string;
  bank_code?: string;
  agency?: string;
  account?: string;
  account_type?: string;
  holder_doc?: string;
  message?: string;
  types?: string[];
}

export interface HomeData {
  today: string;
  live: Live;
  next_cults: Cult[];
  word: Word | null;
  notices: Notice[];
  events: EventItem[];
  videos: Video[];
  photos: { id: number; thumb_id: string; album_id: number | null }[];
  birthdays: { id: number; name: string; picture: string | null; md: string; today: boolean }[];
  campaigns: (Campaign & { done_today: number })[];
  pending: { users: number; testimonies: number; visitors: number; requests: number; help?: number } | null;
  pastor?: PastorMessage | null;
}

/** "Cenas que pregam": trecho de vídeo oficial da série The Chosen (pelo player do YouTube) ligado a uma passagem. */
export interface Scene {
  id: number;
  youtube_id: string;
  start_s: number;
  end_s: number | null;
  title: string;
  episode: string | null;
  channel: string | null;
  bible_book: number;
  bible_chapter: number;
  bible_verse: number | null;
  bible_verse_end: number | null;
  pastor_text: string | null;
  questions: string[];
  visibility: Visibility;
  created_at: number;
  updated_at: number;
}

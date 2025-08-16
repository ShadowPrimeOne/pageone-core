// Central list of AU directories, social hosts, and maps/places
// Used by discovery and scraping.

export type DirectoryDef = {
  key: string
  name: string
  hosts: string[]
  category: 'directory' | 'review' | 'leads' | 'maps' | 'social'
  weight?: number // optional importance for scoring
}

export const AU_DIRECTORIES: DirectoryDef[] = [
  { key: 'google_business_profile', name: 'Google Business Profile', hosts: ['google.com', 'google.com.au'], category: 'maps', weight: 10 },
  { key: 'apple_maps', name: 'Apple Maps', hosts: ['maps.apple.com', 'apple.com'], category: 'maps', weight: 8 },
  { key: 'bing_places', name: 'Bing Places', hosts: ['bing.com', 'bingplaces.com'], category: 'maps', weight: 7 },

  { key: 'yellow_pages', name: 'Yellow Pages Australia', hosts: ['yellowpages.com.au'], category: 'directory', weight: 6 },
  { key: 'white_pages', name: 'White Pages Australia', hosts: ['whitepages.com.au'], category: 'directory', weight: 5 },
  { key: 'true_local', name: 'True Local', hosts: ['truelocal.com.au'], category: 'directory', weight: 5 },
  { key: 'localsearch', name: 'Localsearch', hosts: ['localsearch.com.au'], category: 'directory', weight: 5 },
  { key: 'yelp', name: 'Yelp Australia', hosts: ['yelp.com.au', 'yelp.com'], category: 'review', weight: 5 },
  { key: 'womo', name: 'Word of Mouth (WOMO)', hosts: ['womo.com.au'], category: 'review', weight: 5 },
  { key: 'oneflare', name: 'Oneflare', hosts: ['oneflare.com.au'], category: 'leads', weight: 4 },
  { key: 'hotfrog', name: 'Hotfrog', hosts: ['hotfrog.com.au'], category: 'directory', weight: 4 },
  { key: 'purelocal', name: 'PureLocal', hosts: ['purelocal.com.au'], category: 'directory', weight: 3 },
  { key: 'startlocal', name: 'StartLocal', hosts: ['startlocal.com.au'], category: 'directory', weight: 3 },
  { key: 'aussieweb', name: 'AussieWeb', hosts: ['aussieweb.com.au'], category: 'directory', weight: 3 },
  { key: 'dlook', name: 'dLook', hosts: ['dlook.com.au'], category: 'directory', weight: 3 },
  { key: 'businesslistings', name: 'BusinessListings.net.au', hosts: ['businesslistings.net.au'], category: 'directory', weight: 3 },
  { key: 'brownbook', name: 'Brownbook', hosts: ['brownbook.net'], category: 'directory', weight: 2 },
  { key: 'infobel', name: 'Infobel', hosts: ['infobel.com'], category: 'directory', weight: 2 },
  { key: 'pinkpages', name: 'Pink Pages', hosts: ['pinkpages.com.au'], category: 'directory', weight: 2 },
  { key: 'abd', name: 'Australian Business Directory', hosts: ['australianbusinessdirectory.com.au'], category: 'directory', weight: 2 },

  // Mapping/data providers beyond the big three (for discovery context)
  { key: 'whereis', name: 'Whereis', hosts: ['whereis.com'], category: 'maps', weight: 1 },
  { key: 'mapquest', name: 'MapQuest', hosts: ['mapquest.com'], category: 'maps', weight: 1 },
  { key: 'tomtom', name: 'TomTom', hosts: ['tomtom.com'], category: 'maps', weight: 1 },
  { key: 'here', name: 'HERE', hosts: ['here.com'], category: 'maps', weight: 1 },

  // Socials (for presence tracking; not always scrapable without JS/auth)
  { key: 'facebook', name: 'Facebook', hosts: ['facebook.com'], category: 'social', weight: 4 },
  { key: 'instagram', name: 'Instagram', hosts: ['instagram.com'], category: 'social', weight: 3 },
  { key: 'linkedin', name: 'LinkedIn', hosts: ['linkedin.com'], category: 'social', weight: 3 },
  { key: 'x', name: 'X (Twitter)', hosts: ['x.com', 'twitter.com'], category: 'social', weight: 2 },
  { key: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], category: 'social', weight: 2 },
  { key: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'], category: 'social', weight: 2 },
  { key: 'foursquare', name: 'Foursquare', hosts: ['foursquare.com'], category: 'social', weight: 2 },
  { key: 'nextdoor', name: 'Nextdoor', hosts: ['nextdoor.com'], category: 'social', weight: 2 },
]

export const AU_DIRECTORY_HOSTS = Array.from(new Set(
  AU_DIRECTORIES.filter(d => d.category === 'directory' || d.category === 'review' || d.category === 'leads')
    .flatMap(d => d.hosts)
))

export const AU_SOCIAL_HOSTS = Array.from(new Set(
  AU_DIRECTORIES.filter(d => d.category === 'social').flatMap(d => d.hosts)
))

export const AU_MAPS_PLACES_HOSTS = Array.from(new Set(
  AU_DIRECTORIES.filter(d => d.category === 'maps').flatMap(d => d.hosts)
))

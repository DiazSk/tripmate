Pod::Spec.new do |s|
  s.name           = 'ApplePlaces'
  s.version        = '1.0.0'
  s.summary        = 'Places near a point from Apple Maps, searched on the device'
  s.description    = 'MKLocalSearch and MKLocalPointsOfInterestRequest for the Nearby sheet'
  s.license        = 'UNLICENSED'
  s.author         = 'TripMate'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }

  s.dependency 'ExpoModulesCore'

  s.static_framework = true
  s.source_files = "**/*.{h,m,swift}"
end

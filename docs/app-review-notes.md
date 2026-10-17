# App Review notes — release candidate

Darbna is a navigation app for Iraq. No account or sign-in is required.

TESTING OUTSIDE IRAQ
Allow foreground location, or use the labelled Erbil tour option when outside Iraq or location is unavailable. This is a public fixed tour position, not the user's actual location. Search for Erbil Citadel or Erbil airport and explicitly press the full-search button for remote results; typing can show local suggestions. Select a place, request directions and start a route. The labelled Demo mode simulates navigation without driving. Tour/demo positions cannot submit public road reports or contribute traffic samples.

AUDIO
Arabic instructions are bundled Standard Arabic recordings at normal playback speed. Settings includes a voice test. English recordings are also bundled; Sorani uses the available supported voice fallback and reports availability.

LOCATION / CONNECTIVITY
Navigation and live trip updates run in the foreground. No background location is requested. New routes, rerouting, search and community services require connectivity. Downloaded map areas do not provide offline route calculation. Speed-limit and traffic coverage depends on available data.

COMMUNITY REPORTS
Fixed road-condition categories only, without profiles, chat, uploaded photos or free text in the in-app report feed. Users can flag a wrong/abusive report or mark it gone; three flags hide it. “Block this reporter” hides all current and future reports from that sender for the blocking installation. Private moderator bans prevent new reports. The separate map-problem form posts text and location publicly to OpenStreetMap, not the Darbna report feed. Permanent public security-checkpoint queues concern road delays; no police patrols or DUI checkpoints are offered. Do not test emergency services: SOS opens the dialler for 911 only after user action.

PRIVACY
Traffic contribution is off by default and requires an explicit choice. Real-navigation samples use a pseudonymous trip code and withhold the first/latest 300 m. Road reports and trip sharing use a random installation identifier. Deletion waits for server confirmation; the policy explains retention, third-party services and limits.
Privacy: https://arsalanbaider67-eng.github.io/darbna/privacy.html
Support: https://arsalanbaider67-eng.github.io/darbna/support.html

PRE-SUBMISSION HOLD: moderation operation and physical-device acceptance checks must be completed before final App Store submission. This draft does not assert those checks passed.

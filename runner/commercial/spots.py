# COMMERCIALS-1112 v3 scripts — the real walkthrough. say = what Kokoro reads (spelled to be heard right); cap = on-screen caption.
# Value first: no prices on screen or in the voice. Close: "Get your key — first 500 only."
# kinds: flow (Flow video), room (Flow still + REAL app footage on its screen), app (full-screen REAL live app footage).
WCH = "1630:917:0:96"
def F(say, src, cap=None, **k): return dict(kind="flow", say=say, src=src, cap=cap or say, **k)
def R(say, room, clip, t0=0, cap=None, **k): return dict(kind="room", say=say, room=room, clip=clip, t0=t0, cap=cap or say, **k)
def A(say, clip, tv, th=None, cap=None, **k): return dict(kind="app", say=say, clip=clip, t=(tv, tv if th is None else th), cap=cap or say, **k)
KEY_END = dict(end_say="Get your key at the wow dot online. First five hundred only. One key. Every door. Above The Hill. There's more.",
               end_cap="Get your key at thewow.online. First 500 only. One key. Every door. Above The Hill — there's more.")
DOOR = "flow1112-door-open.mp4"

SPOTS = {
 "master": dict(file="ATH-01-MASTER-WALKTHROUGH", song="passport", door=True, card=["Welcome to Above The Hill.", "One key. Every door."],
   url="thewow.online", urgency="Get your key — first 500 only.", **KEY_END,
   beats=[
    F("Aye. You made it. Here's your key.", DOOR, pre=1.1),
    R("Welcome to Above The Hill. They told you all you needed was a website. Nah. You need a whole headquarters.", "living", "wavsites", 0, tr="fade"),
    A("This wall right here is your home on the internet. Your music, your videos, your shop, your bookings. All behind one link. Pick the look, and it's live.",
      "wavsites", 2, 2, cap="This wall is your home on the internet. Music, videos, shop, bookings — all behind one link. Pick the look, and it's live.", tr="zoomin"),
    R("Down the hall, your own TV channel. Not a playlist. A channel.", "cinema", "wowtv", 1, tr="fadeblack"),
    A("On air twenty four seven, with a guide that shows what's on now, and what's on next.", "wowtv", 6, 6,
      cap="On air 24/7, with a guide that shows what's on now — and what's next.", tr="zoomin"),
    R("Take the elevator. Fifteen floors. This is Power Tribes.", "board", "pt", 9, cap="Take the elevator. Fifteen floors. This is PowerTribes.", tr="fadeblack"),
    A("Your sales floor. Your dialer. Your A.I. workforce. Your whole company, in one tower.", "pt", 11, 13,
      cap="Your sales floor. Your dialer. Your AI workforce. Your whole company, in one tower.", tr="zoomin"),
    R("Next door, the studio. Make the record. Cut the video. Then send it straight to your channel.", "studio", "studios", 9, tr="fadeblack"),
    A("And when you need something built, you just say it. Spade-bot builds it.", "spaidbot", 0,
      cap="Need something built? Just say it. Spaidbot builds it.", tr="smoothleft"),
    R("Last stop, the penthouse. W.M. Pro shows you who's buying, who's selling, and where they're stacked.", "trading", "wmcharts", 3,
      cap="Last stop: the penthouse. WM Pro shows who's buying, who's selling, and where they're stacked.", tr="fadeblack", wm=True),
    A("All before you risk a dollar.", "wmcharts5", 6, 6, crop_h=WCH, tr="zoomin", wm=True),
    A("One key opens every door. Your wow Passport. World of Wealth.", "passport", 0, 1.5, hold=True, upto=(5.0, None), cap="One key opens every door. Your WOW Passport — World of Wealth.", tr="fade"),
   ], disclaimer="WM Pro: education, not financial advice. Live BTC-USD chart."),

 "wowtv": dict(file="ATH-02-WOW-TV", song="passport", card=["WOW TV", "Your channel. On air tonight."], url="thewow.online", urgency="Get your key — first 500 only.", **KEY_END,
   beats=[
    R("Your music deserves more than a three second scroll.", "cinema", "wowtv", 0, cap="Your music deserves more than a 3-second scroll."),
    R("So picture this. The lights go down, and your show comes on. Your channel.", "cinema", "wowtv", 2, light=False, tr="fade",
      cap="Picture this. Lights down. Your show comes on. Your channel."),
    A("On air all night, with a real guide. People tune in for what's on now, and stay for what's next.", "wowtv", 5, 6,
      cap="On air all night, with a real guide. They tune in for what's on now — and stay for what's next.", tr="zoomin"),
    A("Got music, a podcast, a show? Ask for your channel.", "creators", 0, tr="smoothleft"),
   ]),

 "wavemotion": dict(file="ATH-03-WAVEMOTION", song="passport", card=["WAVEMOTION", "Give your work a home."], url="wavemotion.live", urgency="Get your key — first 500 only.",
   end_say="Wave Motion. Give your work a home. Wave motion dot live.", end_cap="WAVEMOTION. Give your work a home. wavemotion.live",
   beats=[
    A("They said put it in your bio. Nah.", "wavsites", 0, cap="They said put it in your bio. Nah."),
    R("Give it a home. Your name on the door, the lights on, and everything you make on the wall.", "living", "showstage", 0, tr="fadeblack",
      cap="Give it a home. Your name on the door, lights on, everything you make on the wall."),
    A("Your music, your videos, your shop, your bookings. One link.", "showstage", 2, tr="zoomin"),
    A("Pick the room that feels like you, and it's live.", "showatmo", 1, tr="smoothleft"),
    A("Then watch who actually clicks.", "showstudio", 2, tr="smoothleft"),
   ]),

 "powertribes": dict(file="ATH-04-POWERTRIBES", song="kingdavid", card=["PowerTribes", "Your company's own tower."], url="powertribes.cloud", urgency="Get your key — first 500 only.",
   end_say="Power Tribes. Your company's own tower. Power tribes dot cloud.", end_cap="PowerTribes. Your company's own tower. powertribes.cloud",
   beats=[
    A("Your business isn't a contact list. It's a tower.", "pt", 0),
    R("Walk into the boardroom, and the whole company is on the wall.", "board", "pt", 9, tr="fadeblack"),
    A("Ride the elevator. The sales floor: the desks, the dialer, the deals, the coaching room.", "pt", 9, 12, tr="zoomin",
      cap="Ride the elevator. The sales floor: desks, dialer, deals, coaching room."),
    A("Your A.I. workforce, one floor up. Everybody in one building.", "pt", 24.5, 27.5, cap="Your AI workforce, one floor up. Everybody in one building.", tr="smoothup"),
   ]),

 "studios": dict(file="ATH-05-WOW-STUDIOS", song="kingdavid", card=["WOW Studios", "Make it here. Air it tonight."], url="wowstudios.cloud", urgency="Get your key — first 500 only.",
   end_say="Wow Studios. Make it here. Air it tonight. Wow studios dot cloud.", end_cap="WOW Studios. Make it here. Air it tonight. wowstudios.cloud",
   beats=[
    R("Midnight. The idea hits. No waiting on a session. The studio's already on.", "studio", "studios", 0, cap="Midnight. The idea hits. No waiting on a session — the studio's already on."),
    A("Lay the record. Mix it. Cut the video, right in your browser.", "studios", 9, tr="zoomin", cap="Lay the record. Mix it. Cut the video — right in your browser."),
    A("Your takes stay yours, on your device.", "studios", 14, tr="smoothleft"),
    R("And when it's done, it goes straight to your channel on wow TV.", "cinema", "wowtv", 2, tr="fadeblack", cap="When it's done, it goes straight to your channel on WOW TV."),
   ]),

 "websites": dict(file="ATH-09-ATH-WEBSITES", song="passport", card=["Above The Hill", "Business websites that book."], url="abovethehilldev.online", urgency="Go check it out — we build it first.",
   end_say="Go check it out. Above the hill dev dot online. We build it first.", end_cap="Go check it out: abovethehilldev.online — we build it first.",
   beats=[
    R("It's ten at night. Somebody's ready to book you, right now.", "living", "showbiz", 0, cap="10 PM. Somebody's ready to book you — right now."),
    A("Can they? Or does your site say call back tomorrow?", "showbiz", 0, tr="zoomin", cap="Can they? Or does your site say \"call back tomorrow\"?"),
    A("Above The Hill builds the site that answers. Booking, calls, directions, on any phone.", "showbiz", 1, 7, tr="smoothleft", hold=True,
      cap="Above The Hill builds the site that answers: booking, calls, directions — on any phone."),
    A("And we build it before you pay a dime.", "showstage", 2, tr="fadeblack"),
   ]),

 "hook1": dict(file="ATH-H1-THE-KEY-15s", song="passport", door=True, card=["One key.", "Every door."], url="thewow.online", urgency="Get your key — first 500 only.",
   end_say="Get your key. First five hundred only. The wow dot online.", end_cap="Get your key. First 500 only. thewow.online",
   beats=[F("Somebody just handed you a key.", DOOR, pre=1.1), R("Lights on. Every door in this building is yours.", "living", "wavsites", 0, tr="fade")]),

 "hook2": dict(file="ATH-H2-WM-PRO-LOOK-AGAIN-15s", song="kingdavid", card=["WM Pro", "Study the market. Study yourself."], url="wealthymindsetspro.com", urgency="Get your key — first 500 only.",
   disclaimer="Education, not financial advice. Live BTC-USD chart.",
   end_say="W.M. Pro. Wealthy mindsets pro dot com.", end_cap="WM Pro. wealthymindsetspro.com",
   beats=[A("Ever watch a trade kiss your stop, then fly without you?", "wmcharts", 0, 0, crop_h=WCH, wm=True),
          A("Look again. Now you can see who was stacked there.", "wmcharts5", 6, 6, crop_h=WCH, tr="zoomin", wm=True)]),

 "hook3": dict(file="ATH-H3-WAVEMOTION-HOME-15s", song="passport", card=["WAVEMOTION", "Give your work a home."], url="wavemotion.live", urgency="Get your key — first 500 only.",
   end_say="Wave motion dot live.", end_cap="wavemotion.live",
   beats=[A("Link in bio? Nah.", "wavsites", 0), R("A whole website, with your name on the door.", "living", "showstage", 0, tr="fadeblack"),
          A("Lights on. It's live.", "showstage", 2, tr="zoomin")]),

 "hook4": dict(file="ATH-H4-SPAIDBOT-SAY-IT-15s", song="passport", card=["Spaidbot", "Say it once."], url="spaidbot.cloud", urgency="Get your key — first 500 only.",
   end_say="Spade-bot dot cloud.", end_cap="spaidbot.cloud",
   beats=[R("Don't explain it to five different apps.", "board", "spaidbot", 0),
          A("Tell it what you need, in your own words.", "spaidbot", 1.5, tr="smoothleft"),
          A("Say it once. Spade-bot builds it.", "spaidbot", 4.5, tr="zoomin", cap="Say it once. Spaidbot builds it.")]),

 "hook5": dict(file="ATH-H5-FIRST-500-15s", song="passport", door=True, card=["Founding 500", "When they're gone, they're gone."], url="thewow.online", urgency="Get your key — first 500 only.",
   end_say="Get your key at the wow dot online.", end_cap="Get your key at thewow.online.",
   beats=[F("Five hundred keys. That's it.", DOOR, pre=1.1, cap="500 keys. That's it."),
          R("Every room. Every screen. When they're gone, they're gone.", "cinema", "wowtv", 2, tr="fade")]),

 # RADIO (audio only, 30 s) — for WOW Radio. Not aired: Founder/Queen review first.
 "radio1": dict(radio=True, file="ATH-R1-RADIO-THE-KEY-30s", song="passport", door=True,
   end_say="Get your key at the wow dot online. First five hundred only. One key. Every door. Above The Hill. There's more.",
   beats=[dict(say="Knock knock. Aye, you made it. Here's your key.", pre=1.3),
          dict(say="Behind this door, your own TV channel. Behind that one, your website, with your name on it. Upstairs, a whole tower for your business."),
          dict(say="And one key opens every door. Your wow Passport. World of Wealth. Founding five hundred is open right now, and when they're gone, they're gone.")]),
 "radio2": dict(radio=True, file="ATH-R2-RADIO-TEN-PM-30s", song="passport",
   end_say="Go check it out. Above the hill dev dot online. Above The Hill. There's more.",
   beats=[dict(say="It's ten at night. Somebody's ready to book your business, right now."),
          dict(say="Can they? Or does your website tell them to call back tomorrow? That's money walking out the door."),
          dict(say="Above The Hill builds the site that answers. Booking, calls, directions, on any phone. And we build it before you pay a dime.")]),
 "radio3": dict(radio=True, file="ATH-R3-RADIO-YOUR-CHANNEL-30s", song="kingdavid",
   end_say="Ask for your channel at the wow dot online. Above The Hill. There's more.",
   beats=[dict(say="You made the song. You posted it. And the feed swallowed it in three seconds."),
          dict(say="Not here. On wow TV, your music gets its own channel. On air all night, with a real guide, and people tuning in on purpose."),
          dict(say="Make it in wow Studios. Give it a home on Wave Motion. Put it on the air tonight.")]),
}

# Partner program / Whop apartment-tour cut (11-12): the master walkthrough with the /partners close. No money claims in the spot.
SPOTS["partner"] = dict(SPOTS["master"], file="ATH-10-PARTNER-APARTMENT-TOUR",
    card=["Come up the hill.", "Bring people with you."], url="abovethehilldev.online/partners", urgency="Join the Creator Crew.",
    end_say="Come up the hill. Bring people with you. Join the Creator Crew at above the hill dev dot online slash partners. Above The Hill. There's more.",
    end_cap="Come up the hill. Bring people with you. Join the Creator Crew: abovethehilldev.online/partners. Above The Hill — there's more.")

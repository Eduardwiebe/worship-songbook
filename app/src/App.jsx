import { useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  Home, Music2, ListMusic, Users, CalendarDays, Plus, Settings, Search,
  Upload, FileMusic, Play, Pause, Clock3, MoreHorizontal, X, FileText, CheckCircle2, Eye, ArrowUp, ArrowDown, Trash2, ChevronLeft, ChevronRight, Pencil, Printer, Download, Share2, Maximize2, Columns2, Type, RotateCcw, UserRound, LogOut, LockKeyhole, Heart, Menu,
} from 'lucide-react'
import './App.css'
import './extra.css'
import { analyzeSongChords, deleteSong, getImportedSongs, hasSongPdf, openSongChart, openSongPdf, saveImportedSongs, saveScannedSong, saveSongVariant, songChartUrl, songPdfUrl, updateSong } from './songStore'
import { createSet, deleteSet, getSets, saveSet } from './setStore'
import { deleteMember, getTeam, memberPhoto, saveMember } from './teamStore'
import { createAppointment, deleteAppointment, getAppointments } from './scheduleStore'
import { changePassword, deleteProfilePhoto, getCurrentUser, login, logout, onNativeAuthFailure, profilePhotoUrl, register, updateProfile, uploadProfilePhoto } from './authStore'
import { AuthorizedFrame, AuthorizedImg } from './AuthorizedMedia'
import { installNativeExternalLinkHandler } from './openExternal'
import { authorizedObjectUrl } from './apiConfig'
import { approveBandJoinRequest, bandLogoUrl, createBand, createBandInvite, deleteBand, deleteBandLogo, getBands, getBandInvites, getBandJoinRequests, getBandMembers, getMyJoinRequests, joinBandByCode, rejectBandJoinRequest, requestBandJoin, searchBands, selectBand, selectPersonal, updateBand, uploadBandLogo } from './bandStore'
import Onboarding from './onboarding/Onboarding'
import { getOnboarding, resetOnboarding, dismissOnboarding } from './onboardingStore'
import { useI18n } from './i18n'
import { useTheme } from './theme.jsx'
import { AuthScreen, PasswordRequired } from './AuthScreen'
import SettingsPage from './SettingsPage'
import { AboutDialog, UpdateDialog } from './AboutDialogs'
import { installNativeDesktopChrome } from './nativeDesktop'
import { URL_EDUARD_WIEBE, URL_LYRUMA_STUDIO, APP_VERSION } from './appMeta'

const initialSongs = []

function App() {
  const { t, locale } = useI18n()
  const { theme } = useTheme()
  const navItems = [
    ['/', t('nav.home'), Home],
    ['/sets', t('nav.sets'), ListMusic],
    ['/bands', t('nav.bands'), Users],
    ['/team', t('nav.team'), Users],
    ['/termine', t('nav.appointments'), CalendarDays],
  ]
  const [authLoading,setAuthLoading]=useState(true)
  const [user,setUser]=useState(null)
  const [songs, setSongs] = useState(initialSongs)
  const [sets, setSets] = useState([])
  const [team, setTeam] = useState([])
  const [appointments, setAppointments] = useState([])
  const [bands,setBands]=useState([])
  const [onboarding,setOnboarding]=useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [createSetOpen, setCreateSetOpen] = useState(false)
  const [editingSong, setEditingSong] = useState(null)
  const [teamDialogOpen, setTeamDialogOpen] = useState(false)
  const [appointmentSetId, setAppointmentSetId] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [updateResult, setUpdateResult] = useState(undefined)
  const [updateOpen, setUpdateOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(()=>{getCurrentUser().then(({user})=>setUser(user)).catch(()=>setUser(null)).finally(()=>setAuthLoading(false))},[])
  useEffect(()=>{onNativeAuthFailure(()=>setUser(null))},[])
  useEffect(()=>installNativeExternalLinkHandler(),[])
  useEffect(() => {
    let disposed = false
    let cleanup = null
    installNativeDesktopChrome({
      t,
      locale,
      onAbout: () => setAboutOpen(true),
      onSettings: () => navigate('/einstellungen'),
      onUpdateResult: (result) => {
        setUpdateResult(result)
        setUpdateOpen(true)
      },
    }).then((fn) => {
      if (disposed) return
      cleanup = fn
    }).catch((error) => {
      console.warn('[nativeDesktop]', error?.message || error)
    })
    return () => {
      disposed = true
      if (typeof cleanup === 'function') cleanup()
    }
  }, [t, locale, navigate])
  useEffect(() => {
    if(!user||user.mustChangePassword)return
    if(!onboarding?.completed||onboarding?.manualRestart)return

    let active=true

    Promise.all([
      getImportedSongs(),
      getSets(),
      getTeam(),
      getAppointments(),
      getBands(),
    ]).then(([storedSongs,storedSets,storedTeam,storedAppointments,storedBands])=>{
      if(!active)return
      setSongs([...storedSongs,...initialSongs])
      setSets(storedSets)
      setTeam(storedTeam)
      setAppointments(storedAppointments)
      setBands(storedBands)
    }).catch((error)=>{
      console.error('Songbook-Daten konnten nicht geladen werden:',error)
    })

    return ()=>{active=false}
  },[user,onboarding?.completed,onboarding?.manualRestart])
  useEffect(() => {
    if(!user || user.mustChangePassword){
      setOnboarding(null)
      return
    }

    setOnboarding(null)

    getOnboarding()
      .then(setOnboarding)
      .catch((error)=>{
        console.error('Onboarding konnte nicht geladen werden:', error)
        setOnboarding({
          step:0,
          completed:true,
          manualRestart:false,
          mode:'',
          data:{}
        })
      })
  }, [user?.id, user?.mustChangePassword])
  useEffect(()=>{
    if(!menuOpen)return

    const onKey=event=>{
      if(event.key==='Escape')setMenuOpen(false)
    }

    const previous=document.body.style.overflow
    document.body.style.overflow='hidden'
    window.addEventListener('keydown',onKey)

    return ()=>{
      document.body.style.overflow=previous
      window.removeEventListener('keydown',onKey)
    }
  },[menuOpen])

  const closeMenu=()=>setMenuOpen(false)
  const go=to=>{
    closeMenu()
    navigate(to)
  }

  if(authLoading)return <div className="auth-loading"><span className="brand-mark">L</span><p>{t('loading')}</p></div>
  if(!user)return <>
    <AuthScreen onAuthenticated={setUser}/>
    {aboutOpen&&<AboutDialog onClose={()=>setAboutOpen(false)}/>}
    {updateOpen&&<UpdateDialog result={updateResult} onClose={()=>{setUpdateOpen(false);setUpdateResult(undefined)}}/>}
  </>
  if(user.mustChangePassword)return <PasswordRequired user={user} onChanged={setUser} onLogout={async()=>{await logout();setUser(null)}}/>
  if(onboarding===null)return <div className="auth-loading"><span className="brand-mark">L</span><p>{t('onboardingLoading')}</p></div>
  if(!onboarding.completed||onboarding.manualRestart)return <>
    {onboarding.manualRestart&&
      <div className="onboarding-dismiss-bar">
        <span>{t('setupLabel')}</span>
        <button
          type="button"
          className="onboarding-dismiss"
          onClick={async()=>setOnboarding(await dismissOnboarding())}
        >
          {t('backToSongbook')}
        </button>
      </div>
    }
    <Onboarding state={onboarding} onState={setOnboarding}/>
    {aboutOpen&&<AboutDialog onClose={()=>setAboutOpen(false)}/>}
    {updateOpen&&<UpdateDialog result={updateResult} onClose={()=>{setUpdateOpen(false);setUpdateResult(undefined)}}/>}
  </>
  const handleLogout=async()=>{await logout();setUser(null);setOnboarding(null);setSongs([]);setSets([]);setTeam([]);setAppointments([])}
  const activeBand=bands.find(item=>item.active)
  const openImport = () => setDialogOpen(true)
  void theme
  void APP_VERSION
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href={URL_LYRUMA_STUDIO} target="_blank" rel="noreferrer" aria-label="Lyruma Studio"><div className="brand-mark">L</div><div><strong>{t('brand.lyruma')}</strong><span>{t('brand.studio')}</span></div></a>
      <nav className="nav">{navItems.map(([to, label, Icon]) =>
        <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => `nav-item${isActive ? ' active' : ''}`}><Icon size={19}/>{label}</NavLink>
      )}</nav>
      <div className="sidebar-bottom">
        <button className="band-switch" onClick={()=>navigate('/bands')}><span className="band-switch-icon"><Users size={17}/></span><span><small>{t('nav.activeScope')}</small><b>{activeBand?.name||t('nav.personalSongbook')}</b></span><ChevronRight size={16}/></button>
        <button className="add-button" onClick={openImport}><Plus size={19}/>{t('nav.add')}</button>
        <NavLink to="/einstellungen" className={({isActive}) => `nav-item${isActive ? ' active' : ''}`}><Settings size={19}/>{t('nav.settings')}</NavLink>
        <button className="nav-item account-nav" onClick={()=>navigate('/einstellungen')}>{user.hasPhoto?<AuthorizedImg className="account-nav-photo" path={profilePhotoUrl(user)} alt=""/>:<UserRound size={19}/>}<span><b>{user.name}</b><small>{user.role==='admin'?t('nav.admin'):t('nav.mySongbook')}</small></span></button>
      </div>
    </aside>

    <header className="mobile-topbar">
      <div className="mobile-topbar-brand">
        <span className="header-songbook-mark" aria-hidden="true"><Music2 size={20}/></span>
        <strong>{t('brand.songbook')}</strong>
      </div>
      <button
        type="button"
        className="menu-toggle"
        aria-label={t('nav.openMenu')}
        aria-expanded={menuOpen}
        onClick={()=>setMenuOpen(true)}
      >
        <Menu size={22}/>
      </button>
    </header>

    {menuOpen&&
      <>
        <button type="button" className="nav-backdrop" aria-label={t('nav.closeMenu')} onClick={closeMenu}/>
        <aside className="nav-drawer" role="dialog" aria-modal="true" aria-label={t('nav.mainNav')}>
          <div className="nav-drawer-head">
            <a className="brand" href={URL_LYRUMA_STUDIO} target="_blank" rel="noreferrer" aria-label="Lyruma Studio">
              <div className="brand-mark">L</div>
              <div><strong>{t('brand.lyruma')}</strong><span>{t('brand.studio')}</span></div>
            </a>
            <button type="button" className="nav-drawer-close" aria-label={t('nav.closeMenu')} onClick={closeMenu}>
              <X size={22}/>
            </button>
          </div>

          <nav className="nav">
            {navItems.map(([to, label, Icon]) =>
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={closeMenu}
                className={({isActive}) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={19}/>{label}
              </NavLink>
            )}
          </nav>

          <div className="sidebar-bottom">
            <button className="band-switch" onClick={()=>go('/bands')}>
              <span className="band-switch-icon"><Users size={17}/></span>
              <span><small>{t('nav.activeScope')}</small><b>{activeBand?.name||t('nav.personalSongbook')}</b></span>
              <ChevronRight size={16}/>
            </button>
            <button className="add-button" onClick={()=>{closeMenu();openImport()}}><Plus size={19}/>{t('nav.add')}</button>
            <NavLink to="/einstellungen" onClick={closeMenu} className={({isActive}) => `nav-item${isActive ? ' active' : ''}`}><Settings size={19}/>{t('nav.settings')}</NavLink>
            <button className="nav-item account-nav" onClick={()=>go('/einstellungen')}>
              {user.hasPhoto?<AuthorizedImg className="account-nav-photo" path={profilePhotoUrl(user)} alt=""/>:<UserRound size={19}/>}
              <span><b>{user.name}</b><small>{user.role==='admin'?t('nav.admin'):t('nav.mySongbook')}</small></span>
            </button>
          </div>
        </aside>
      </>
    }

    <main className="content">
      <Routes>
        <Route path="/" element={<HomePage songs={songs} setSongs={setSongs} sets={sets} openImport={openImport} openSetDialog={() => setCreateSetOpen(true)} navigate={navigate}/>}/>
        <Route path="/songs" element={<SongsPage songs={songs} openImport={openImport} onTranspose={(song)=>navigate(`/songs/${song.id}/editor`)} onEdit={setEditingSong} onDelete={async (song) => { if (!window.confirm(`„${song.title}“ und die zugehörige PDF wirklich endgültig löschen?`)) return; await deleteSong(song.id); setSongs((current) => current.filter((item) => item.id !== song.id)); setSets((current) => current.map((set) => ({...set, songIds: set.songIds.filter((id) => id !== song.id)}))) }}/>}/>
        <Route path="/songs/:songId/editor" element={<SongEditorRoute songs={songs} setSongs={setSongs} navigate={navigate}/>}/>
        <Route path="/bands" element={<BandsPage bands={bands} onRefresh={setBands}/>}/>
        <Route path="/sets" element={<SetsPage sets={sets} onCreate={() => setCreateSetOpen(true)} navigate={navigate}/>}/>
        <Route path="/sets/:setId" element={<SetDetailPage sets={sets} songs={songs} team={team} updateSets={setSets} navigate={navigate}/>}/>
        <Route path="/team" element={<TeamPage team={team} onAdd={() => setTeamDialogOpen(true)} onDelete={async (member) => { if(!window.confirm(`${member.name} wirklich aus dem Team entfernen?`))return;await deleteMember(member.id);setTeam((current)=>current.filter((item)=>item.id!==member.id)) }}/>}/>
        <Route path="/termine" element={<AppointmentsPage sets={sets} appointments={appointments} onAdd={(setId='') => setAppointmentSetId(setId||sets[0]?.id||'')} onDelete={async (item)=>{if(!window.confirm(`Termin „${item.title}“ löschen?`))return;await deleteAppointment(item.id);setAppointments((current)=>current.filter((entry)=>entry.id!==item.id))}} navigate={navigate}/>}/>
        <Route path="/einstellungen" element={<SettingsPage Header={Header} user={user} onUser={setUser} onLogout={handleLogout} onRestartOnboarding={async()=>setOnboarding(await resetOnboarding())}/>}/>
        <Route path="*" element={<SimplePage eyebrow="404" title={t('pages.notFound')} text={t('pages.notFoundText')}/>}/>
      </Routes>
      <Footer/>
    </main>

    <nav className="mobile-nav">
      <NavLink to="/" onClick={closeMenu}><Home size={20}/><span>{t('nav.home')}</span></NavLink>
      <NavLink to="/bands" onClick={closeMenu}><Users size={20}/><span>{t('nav.bands')}</span></NavLink>
      <button className="mobile-add" onClick={openImport} aria-label={t('nav.add')}><Plus size={22}/></button>
      <NavLink to="/sets" onClick={closeMenu}><ListMusic size={20}/><span>{t('nav.sets')}</span></NavLink>
      <button type="button" onClick={()=>setMenuOpen(true)} aria-label={t('nav.more')}><MoreHorizontal size={20}/><span>{t('nav.more')}</span></button>
    </nav>
    {dialogOpen && <ImportDialog onClose={() => setDialogOpen(false)} onImport={async (items) => { const storedSongs = await saveImportedSongs(items); setSongs((current) => [...storedSongs, ...current]); setDialogOpen(false); navigate('/songs') }} onScan={async(title,pages)=>{const song=await saveScannedSong(title,pages);setSongs(current=>[song,...current]);setDialogOpen(false);navigate(`/songs/${song.id}/editor`)}}/>} 
    {createSetOpen && <CreateSetDialog onClose={() => setCreateSetOpen(false)} onCreate={async (values) => { const next = await createSet(values); setSets((current) => [next, ...current]); setCreateSetOpen(false); navigate(`/sets/${next.id}`) }}/>} 
    {editingSong && <EditSongDialog song={editingSong} onClose={() => setEditingSong(null)} onSave={async (changes) => { const updated = await updateSong(editingSong.id, changes); setSongs((current) => current.map((song) => song.id === editingSong.id ? {...song, ...updated} : song)); setEditingSong(null) }}/>} 
    {teamDialogOpen && <TeamDialog onClose={() => setTeamDialogOpen(false)} onSave={async (values) => { const member=await saveMember(values);setTeam((current)=>[...current,member].sort((a,b)=>a.name.localeCompare(b.name)));setTeamDialogOpen(false) }}/>} 
    {appointmentSetId && <AppointmentDialog sets={sets} initialSetId={appointmentSetId} onClose={()=>setAppointmentSetId('')} onSave={async(values)=>{const item=await createAppointment(values);setAppointments((current)=>[...current,item].sort((a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));setAppointmentSetId('')}}/>}
    {aboutOpen&&<AboutDialog onClose={()=>setAboutOpen(false)}/>}
    {updateOpen&&<UpdateDialog result={updateResult} onClose={()=>{setUpdateOpen(false);setUpdateResult(undefined)}}/>}
  </div>
}

function Footer() {
  const { t } = useI18n()
  const social = [
    ['Facebook','https://www.facebook.com/people/Lyruma/61591920364451/','f'],
    ['Instagram','https://www.instagram.com/lyrumastudio/','◎'],
    ['YouTube','https://www.youtube.com/@LyrumaStudio','▶'],
    ['GitHub','https://github.com/eduardwiebe','<>'],
  ]
  const donationUrl='https://www.paypal.com/donate?business=eduardwiebe77%40gmail.com&no_recurring=0&item_name=Worship+Songbook+Open+Source+Entwicklung&currency_code=EUR'
  return <footer className="app-footer"><section className="donation-card"><span className="donation-heart"><Heart size={23}/></span><div><strong>{t('footer.supportTitle')}</strong><p>{t('footer.supportText')}</p></div><a href={donationUrl} target="_blank" rel="noreferrer"><Heart size={17}/>{t('footer.paypal')}</a></section><div className="footer-main"><div><strong>{t('brand.songbook')}</strong><span>{t('footer.openSource')}</span></div><nav aria-label="Websites"><a href={URL_LYRUMA_STUDIO} target="_blank" rel="noreferrer">Lyruma Studio</a><a href="https://lyruma.app" target="_blank" rel="noreferrer">Lyruma App</a><a href={URL_EDUARD_WIEBE} target="_blank" rel="noreferrer">Eduard Wiebe</a></nav></div><div className="footer-bottom"><nav aria-label="Legal"><a href="/nutzungsbedingungen.html" target="_blank" rel="noreferrer">{t('footer.terms')}</a><a href="/datenschutz.html" target="_blank" rel="noreferrer">{t('footer.privacy')}</a><a href="/impressum.html" target="_blank" rel="noreferrer">{t('footer.imprint')}</a></nav><div className="social-links" aria-label="Social Media">{social.map(([name,url,glyph])=><a key={name} href={url} target="_blank" rel="noreferrer" title={name} aria-label={name}><span aria-hidden="true">{glyph}</span></a>)}<a href="https://www.tiktok.com/@lyrumastudio" target="_blank" rel="noreferrer" title="TikTok" aria-label="TikTok" className="tiktok-icon"><span aria-hidden="true">♪</span></a></div></div><p>{t('footer.rights', { year: new Date().getFullYear() })}</p></footer>
}

function Header({title, subtitle}) {
  return <header className="topbar app-header page-header">
    <div className="header-brand">
      <span className="header-songbook-mark" aria-hidden="true"><Music2 size={22}/></span>
      <div>
        <p className="eyebrow header-brand-eyebrow">Lyruma Worship</p>
        <h1>{title}</h1>
        {subtitle&&<p className="subtitle">{subtitle}</p>}
      </div>
    </div>
  </header>
}

function HomePage({songs, setSongs, sets, openImport, openSetDialog, navigate}) {
  const [query,setQuery]=useState('');const [activeSlide,setActiveSlide]=useState(0);const [playing,setPlaying]=useState(false);const [selectedSongId,setSelectedSongId]=useState('');const shown=songs.filter((song)=>`${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase())).slice(0,12);const selectedSong=songs.find((song)=>song.id===selectedSongId)
  const inspirationSlides=[{kind:'intro',title:'Lieder finden. Gemeinsam wachsen.',artist:'Dein Worship Songbook für Bibliothek, Sets, Proben und Bühne.',image:'/worship-neutral.svg'},{kind:'video',title:'Nichts unmöglich',artist:'ICF Karlsruhe Music',videoId:'neZnq_5bXkA'},{kind:'video',title:'Generation',artist:'X Worship',videoId:'ir3ZRcUsdW0'}];const safeSlide=activeSlide<inspirationSlides.length?activeSlide:0;const slide=inspirationSlides[safeSlide];const slideImage=slide.videoId?`https://i.ytimg.com/vi/${slide.videoId}/hqdefault.jpg`:slide.image
  const { t } = useI18n()
  return <><Header title={t('home.title')} subtitle={t('home.subtitle')}/>
    <label className="home-search"><Search size={24}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={t('home.searchPlaceholder')} autoComplete="off"/>{query&&<button onClick={()=>setQuery('')} aria-label="Suche löschen"><X size={18}/></button>}</label>
    <section className={`home-hero inspiration-hero${playing?' is-playing':''}`} aria-label="Inspiration und neue Worship-Songs"><img className="hero-background" src={slideImage} alt=""/><div className="hero-shade"/>{playing&&slide.videoId?<div className="hero-player"><iframe src={`https://www.youtube-nocookie.com/embed/${slide.videoId}?autoplay=1&rel=0`} title={`${slide.title} auf YouTube`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/><button onClick={()=>setPlaying(false)} aria-label="Video schließen"><X size={20}/>Schließen</button></div>:<><button className="hero-arrow hero-arrow-left" onClick={()=>{setPlaying(false);setActiveSlide((safeSlide-1+inspirationSlides.length)%inspirationSlides.length)}} aria-label="Vorheriger Inhalt"><ChevronLeft size={25}/></button><div className={`hero-content${slide.kind==='intro'?' intro-slide':''}`}>{slide.kind==='video'&&<img className="hero-poster" src={slideImage} alt={`Cover ${slide.title}`}/>}<div className="hero-copy"><p className="hero-label">{slide.kind==='intro'?'Worship Songbook':'Neu im deutschen Worship'}</p><h2>{slide.title}</h2><p className="hero-date">{slide.artist}</p>{slide.kind==='intro'?<div className="intro-features"><span>Liedtexte</span><span>Akkorde</span><span>Sets</span><span>Gemeinsam spielen</span></div>:<button className="hero-set-link" onClick={()=>setPlaying(true)}><Play size={17}/>Zum Lied</button>}</div></div><button className="hero-arrow hero-arrow-right" onClick={()=>{setPlaying(false);setActiveSlide((safeSlide+1)%inspirationSlides.length)}} aria-label="Nächster Inhalt"><ChevronRight size={25}/></button></>}<div className="hero-dots">{inspirationSlides.map((item,index)=><button key={item.title} className={index===safeSlide?'active':''} onClick={()=>{setPlaying(false);setActiveSlide(index)}} aria-label={`Inhalt ${index+1}`}/>)}</div></section>
    {selectedSong?<TransposeDialog embedded homeEmbedded song={selectedSong} onClose={()=>setSelectedSongId('')} onSave={async(values)=>{const variant=await saveSongVariant(selectedSong.id,values);setSongs((current)=>current.map((item)=>item.id===selectedSong.id?{...item,key:variant.targetKey,sourceKey:variant.sourceKey,preferredKey:variant.targetKey,variantKeys:Array.from(new Set([variant.targetKey,...(item.variantKeys||[])]))}:item));return variant}}/>:<><section className="home-section"><div className="home-section-head"><div><p className="eyebrow">Deine Bibliothek</p><h2>{query?`Suchergebnisse für „${query}“`:'Songs direkt öffnen'}</h2></div><button className="text-button" onClick={openImport}><Plus size={17}/>Song hinzufügen</button></div>{shown.length?<div className="song-tile-row">{shown.map((song,index)=><button className="song-tile" key={song.id} onClick={()=>setSelectedSongId(song.id)}><span className={`song-cover cover-tone-${index%6}`}><Music2 size={31}/><span>{song.title}</span><i><Play size={17}/></i></span><span className="song-tile-copy"><span className="song-rank">{index+1}</span>{(song.preferredKey||song.key)&&<span className="song-key">Tonart {song.preferredKey||song.key}</span>}<strong>{song.title}</strong><small>{song.artist||'Worship Songbook'}</small><span className="tile-open">Im Editor öffnen <ChevronRight size={15}/></span></span></button>)}{!query&&songs.length>12&&<button className="song-tile more-tile" onClick={()=>navigate('/songs')}><span className="more-cover"><Plus size={30}/></span><span className="song-tile-copy"><span className="song-rank">12+</span><strong>Alle Songs</strong><small>Gesamte Bibliothek öffnen</small><span className="tile-open">Zur Bibliothek <ChevronRight size={15}/></span></span></button>}</div>:<div className="empty-state small"><Search size={30}/><h3>Kein Song gefunden</h3><p>Probiere einen anderen Suchbegriff oder importiere eine PDF.</p></div>}</section>
    <section className="home-section"><div className="home-section-head"><div><p className="eyebrow">Planung und Rückblick</p><h2>Sets und Veranstaltungen</h2></div><button className="text-button" onClick={openSetDialog}><Plus size={17}/>Neues Set</button></div><div className="set-poster-row">{sets.map((set,index)=><button className="set-poster-card" key={set.id} onClick={()=>navigate(`/sets/${set.id}`)}><div className="set-poster-image">{(set.theme||set.title).toLowerCase().includes('fundament')?<img src="/worship-neutral.svg" alt=""/>:<span className={`poster-placeholder cover-tone-${index%6}`}><ListMusic size={32}/></span>}<span>{formatDate(set.date)}</span></div><strong>{set.theme||set.title}</strong><small>{set.venue||`${set.songIds.length} Songs`}</small></button>)}{!sets.length&&<p className="empty">Noch kein Set geplant.</p>}</div></section>
    <section className="quick-actions home-quick"><button className="primary-action" onClick={openImport}><Upload size={21}/><span><strong>PDFs importieren</strong><small>Mehrere Songs gleichzeitig</small></span></button><button className="secondary-action" onClick={openSetDialog}><ListMusic size={21}/><span><strong>Set planen</strong><small>Songs und Reihenfolge</small></span></button></section></>}
  </>
}

function SongsPage({songs, openImport, onTranspose, onEdit, onDelete}) {
  const { t } = useI18n()
  return <><Header title={t('pages.songs')} subtitle={t('pages.songsSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={openImport}><Plus size={18}/>Song hinzufügen</button></div><SongPanel songs={songs} onTranspose={onTranspose} onEdit={onEdit} onDelete={onDelete}/></>
}

function SongPanel({songs, onAll, onTranspose, onEdit, onDelete}) {
  const [query, setQuery] = useState('')
  const shown = songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="panel"><div className="panel-header"><div><p className="eyebrow">Bibliothek</p><h2>{onAll ? 'Zuletzt verwendete Songs' : `${songs.length} Songs`}</h2></div><div className="search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Songs durchsuchen..."/></div></div>
    <div className="song-list">{shown.map((song, index) => <SongRow key={song.id || `${song.title}-${index}`} song={song} index={index} onTranspose={onTranspose} onEdit={onEdit} onDelete={onDelete}/>)}</div>
    {shown.length === 0 && <p className="empty">Keine Songs gefunden.</p>}{onAll && <button className="text-button" onClick={onAll}>Alle Songs anzeigen →</button>}
  </section>
}

function SongRow({song, index, onTranspose, onEdit, onDelete}) {
  const [revealed, setRevealed] = useState(false)
  const touchStart = useRef(null)
  const finishSwipe = (clientX) => {
    if (touchStart.current === null) return
    const distance = clientX - touchStart.current
    if (distance < -45 && onDelete) setRevealed(true)
    if (distance > 35) setRevealed(false)
    touchStart.current = null
  }
  return <div className={`swipe-row${revealed ? ' revealed' : ''}`}>
    {onDelete && !song.isProtected && <button className="swipe-delete" onClick={() => onDelete(song)} aria-label={`${song.title} löschen`}><Trash2 size={22}/><span>Löschen</span></button>}
    <article className="song-row" onTouchStart={(event) => { touchStart.current = event.touches[0].clientX }} onTouchEnd={(event) => finishSwipe(event.changedTouches[0].clientX)}>
      <div className="song-number">{String(index + 1).padStart(2, '0')}</div><div className="song-icon"><FileMusic size={21}/></div><div className="song-main"><strong>{song.title}</strong><span>{song.artist}{song.fileName ? ` · ${(song.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}{song.preferredKey?` · Fassung ${song.preferredKey}`:''}{song.isProtected?' · geschützt':''}</span></div><div className="song-meta"><span><b>{song.key || '–'}</b> Tonart</span><span><b>{song.bpm || '–'}</b> BPM</span><span><Clock3 size={14}/>{song.duration || '–'}</span></div>{hasSongPdf(song) && <button className="icon-button" title="PDF öffnen" onClick={() => openSongPdf(song)}><Eye size={18}/></button>}{onTranspose&&<button className="transpose-button" title="Tonart ändern" onClick={()=>onTranspose(song)}><Music2 size={17}/></button>}{onEdit ? <button className="icon-button" title="Song bearbeiten" onClick={() => onEdit(song)}><Pencil size={17}/></button> : <button className="icon-button"><MoreHorizontal size={18}/></button>}{onDelete && !song.isProtected && <button className="desktop-delete" title="Song und PDF löschen" onClick={() => onDelete(song)}><Trash2 size={18}/></button>}
    </article>
  </div>
}

function SimplePage({eyebrow, title, text}) {
  return <><Header title={title} subtitle={text}/><section className="panel placeholder"><p className="eyebrow">{eyebrow}</p><h2>{title} wird als Nächstes ausgebaut</h2><p>Die Navigation funktioniert bereits. Die Inhalte folgen im nächsten Schritt.</p></section></>
}

function BandsPage({bands}) {
  const active=bands.find(item=>item.active)
  const [members,setMembers]=useState({accounts:[],profiles:[]})
  const [error,setError]=useState('')
  const [busy,setBusy]=useState('')
  const [editor,setEditor]=useState(null)
  const [name,setName]=useState('')
  const [description,setDescription]=useState('')
  const [logoFile,setLogoFile]=useState(null)
  const [logoPreview,setLogoPreview]=useState('')
  const [joinRequests,setJoinRequests]=useState([])
  const [invites,setInvites]=useState([])
  const [bandSearch,setBandSearch]=useState('')
  const [bandResults,setBandResults]=useState([])
  const [inviteCode,setInviteCode]=useState('')
  const [myRequests,setMyRequests]=useState([])
  const [joinInfo,setJoinInfo]=useState('')

  useEffect(()=>{
    if(active)getBandMembers(active.id)
      .then(setMembers)
      .catch(()=>setMembers({accounts:[],profiles:[]}))
    else setMembers({accounts:[],profiles:[]})
  },[active?.id])

  useEffect(()=>{
    let current=true

    getMyJoinRequests()
      .then(rows=>{
        if(current)setMyRequests(rows.filter(item=>item.status==='pending'))
      })
      .catch(()=>{
        if(current)setMyRequests([])
      })

    return ()=>{current=false}
  },[bands])

  useEffect(()=>{
    let current=true

    if(!active?.canEdit){
      setJoinRequests([])
      setInvites([])
      return ()=>{current=false}
    }

    Promise.all([
      getBandJoinRequests(),
      getBandInvites(active.id),
    ]).then(([requests,inviteRows])=>{
      if(!current)return
      setJoinRequests(requests.filter(item=>item.bandId===active.id))
      setInvites(inviteRows)
    }).catch((e)=>{
      if(current)setError(e.message)
    })

    return ()=>{current=false}
  },[active?.id,active?.canEdit])

  const runBandSearch=async()=>{
    setBusy('search')
    setError('')
    setJoinInfo('')

    try{
      const rows=await searchBands(bandSearch.trim())
      setBandResults(rows)
      if(!rows.length)setJoinInfo('Keine passende Band gefunden.')
    }catch(e){
      setError(e.message)
    }finally{
      setBusy('')
    }
  }

  const sendJoinRequest=async band=>{
    setBusy(`request-${band.id}`)
    setError('')
    setJoinInfo('')

    try{
      const result=await requestBandJoin(band.id)
      setMyRequests(current=>{
        if(current.some(item=>item.id===result.id))return current
        return [{id:result.id,bandId:result.bandId,bandName:result.bandName,status:result.status},...current]
      })
      setJoinInfo(`Anfrage an „${result.bandName}“ gesendet. Warte auf Freigabe der Bandleitung.`)
      setBandResults([])
      setBandSearch('')
    }catch(e){
      setError(e.message)
    }finally{
      setBusy('')
    }
  }

  const useInviteCode=async()=>{
    setBusy('code')
    setError('')
    setJoinInfo('')

    try{
      const result=await joinBandByCode(inviteCode)
      await selectBand(result.band.id)
      window.location.reload()
    }catch(e){
      setError(e.message)
      setBusy('')
    }
  }

  const decideJoinRequest=async(requestId,decision)=>{
    setBusy(`join-${requestId}`)
    setError('')

    try{
      if(decision==='approve')await approveBandJoinRequest(requestId)
      else await rejectBandJoinRequest(requestId)

      const [requests,nextMembers]=await Promise.all([
        getBandJoinRequests(),
        getBandMembers(active.id),
      ])

      setJoinRequests(requests.filter(item=>item.bandId===active.id))
      setMembers(nextMembers)
    }catch(e){
      setError(e.message)
    }finally{
      setBusy('')
    }
  }

  const createInvite=async()=>{
    setBusy('invite')
    setError('')

    try{
      const invite=await createBandInvite(active.id,{expiresDays:7,maxUses:25})
      setInvites(current=>[invite,...current])
    }catch(e){
      setError(e.message)
    }finally{
      setBusy('')
    }
  }

  const openCreate=()=>{
    setEditor({mode:'create'})
    setName('')
    setDescription('')
    setLogoFile(null)
    setLogoPreview('')
    setError('')
  }

  const openEdit=band=>{
    setEditor({mode:'edit',id:band.id,hasLogo:band.hasLogo})
    setName(band.name)
    setDescription(band.description||'')
    setLogoFile(null)
    setLogoPreview(band.hasLogo?bandLogoUrl(band):'')
    setError('')
  }

  const closeEditor=()=>{
    setEditor(null)
    setName('')
    setDescription('')
    setLogoFile(null)
    setLogoPreview('')
  }

  const chooseLogo=event=>{
    const file=event.target.files?.[0]
    if(!file)return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const saveBand=async()=>{
    if(name.trim().length<2)return

    setBusy('save')
    setError('')

    try{
      let saved

      if(editor?.mode==='edit'){
        saved=await updateBand(editor.id,{
          name:name.trim(),
          description:description.trim()
        })
      }else{
        saved=await createBand({
          name:name.trim(),
          description:description.trim()
        })
      }

      if(logoFile)
        await uploadBandLogo(saved.id,logoFile)

      window.location.reload()
    }catch(e){
      setError(e.message)
      setBusy('')
    }
  }

  const removeLogo=async()=>{
    if(!editor?.id)return
    setBusy('logo-delete')

    try{
      await deleteBandLogo(editor.id)
      window.location.reload()
    }catch(e){
      setError(e.message)
      setBusy('')
    }
  }

  const activate=async band=>{
    setBusy(band.id)
    setError('')

    try{
      await selectBand(band.id)
      window.location.reload()
    }catch(e){
      setError(e.message)
      setBusy('')
    }
  }

  const removeBand=async band=>{
    if(!window.confirm(`Band „${band.name}“ wirklich löschen?\n\nBand-Sets und Band-Termine werden gelöscht. Deine persönlichen Songs und Teamprofile bleiben erhalten.`))return

    setBusy(`delete-${band.id}`)
    setError('')

    try{
      await deleteBand(band.id)
      window.location.reload()
    }catch(e){
      setError(e.message)
      setBusy('')
    }
  }

  const personal=async()=>{
    setBusy('personal')
    setError('')

    try{
      await selectPersonal()
      window.location.reload()
    }catch(e){
      setError(e.message)
      setBusy('')
    }
  }

  return <>
    <Header title="Bands" subtitle="Gemeinsame Songbooks für eure Bands, Sets und Proben."/>

    <div className="page-actions">
      <button className="add-button compact" onClick={openCreate}>
        <Plus size={18}/>Band anlegen
      </button>
    </div>

    <section className="band-current">
      <div>
        <p className="eyebrow">Aktiver Arbeitsbereich</p>
        <h2>{active?.name||'Persönliches Songbook'}</h2>
        <p>{active?.description||'Nur deine persönlichen Songs und Planungen.'}</p>
      </div>

      {active&&
        <button className="personal-button" onClick={personal} disabled={busy==='personal'}>
          {busy==='personal'?'Wechselt …':'Zum persönlichen Songbook'}
        </button>
      }
    </section>

    {error&&<p className="auth-error">{error}</p>}

    {editor&&
      <section className="panel band-editor">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Bandverwaltung</p>
            <h2>{editor.mode==='create'?'Neue Band anlegen':'Band bearbeiten'}</h2>
          </div>

          <button className="icon-button" onClick={closeEditor}>
            <X size={19}/>
          </button>
        </div>

        <div className="band-logo-editor">
          <label className="band-logo-picker">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={chooseLogo}
            />

            {logoPreview
              ? <img src={logoPreview} alt="Band-Logo Vorschau"/>
              : <>
                  <Users size={25}/>
                  <strong>Band-Logo</strong>
                  <span>JPG, PNG oder WebP</span>
                </>
            }
          </label>

          <div>
            <strong>Logo der Band</strong>
            <p>Optional. Das Logo erscheint bei der Band-Auswahl und hilft Teams bei der Orientierung.</p>

            {editor.mode==='edit'&&editor.hasLogo&&
              <button
                className="profile-photo-remove"
                disabled={busy==='logo-delete'}
                onClick={removeLogo}
              >
                <Trash2 size={16}/>
                Logo entfernen
              </button>
            }
          </div>
        </div>

        <div className="band-editor-fields">
          <label className="field">
            <span>Bandname</span>
            <div>
              <Users size={18}/>
              <input
                value={name}
                maxLength={80}
                onChange={e=>setName(e.target.value)}
                placeholder="Name deiner Band"
                autoFocus
              />
            </div>
          </label>

          <label className="field">
            <span>Beschreibung</span>
            <textarea
              value={description}
              maxLength={300}
              onChange={e=>setDescription(e.target.value)}
              placeholder="Optional, z. B. Worship-Team unserer Gemeinde"
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="cancel-button" onClick={closeEditor}>
            Abbrechen
          </button>

          <button
            className="add-button compact"
            disabled={name.trim().length<2||busy==='save'}
            onClick={saveBand}
          >
            <CheckCircle2 size={18}/>
            {busy==='save'
              ? 'Speichert …'
              : editor.mode==='create'
                ? 'Band anlegen'
                : 'Änderungen speichern'}
          </button>
        </div>
      </section>
    }

    {bands.length
      ? <section className="band-grid">
          {bands.map(band=>
            <article className={`band-card${band.active?' active':''}`} key={band.id}>
              <div className="band-card-mark">
                {band.hasLogo
                  ? <AuthorizedImg path={bandLogoUrl(band)} alt=""/>
                  : <Users size={26}/>
                }
              </div>

              <div>
                <span>{band.active?'Aktiv':'Eigene Band'}</span>
                <h3>{band.name}</h3>
                <p>{band.description||'Noch keine Beschreibung.'}</p>
              </div>

              <div className="band-card-actions">
                <button
                  className="band-select-button"
                  disabled={band.active||busy===band.id}
                  onClick={()=>activate(band)}
                >
                  {busy===band.id?'Bitte warten …':band.active?'Ausgewählt':'Band auswählen'}
                </button>

                {band.canEdit&&
                  <button className="band-edit-button" onClick={()=>openEdit(band)}>
                    <Pencil size={17}/>Bearbeiten
                  </button>
                }

                {band.canEdit&&
                  <button
                    className="band-delete-button"
                    disabled={busy===`delete-${band.id}`}
                    onClick={()=>removeBand(band)}
                  >
                    <Trash2 size={17}/>
                    {busy===`delete-${band.id}`?'Löscht …':'Löschen'}
                  </button>
                }
              </div>
            </article>
          )}
        </section>
      : <section className="panel">
          <div className="empty-state">
            <Users size={40}/>
            <h3>Noch keine Band angelegt</h3>
            <p>Dein persönliches Songbook ist aktiv. Wenn du gemeinsam planen möchtest, lege deine erste Band an.</p>
            <button className="add-button compact" onClick={openCreate}>
              <Plus size={18}/>Erste Band anlegen
            </button>
          </div>
        </section>
    }

    {active?.canEdit&&
      <section className="panel band-access-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Bandzugang</p>
            <h2>Beitrittsanfragen und Einladungen</h2>
          </div>

          <button className="add-button compact" onClick={createInvite} disabled={busy==='invite'}>
            <Plus size={17}/>{busy==='invite'?'Erstellt …':'Einladungscode erzeugen'}
          </button>
        </div>

        <div className="band-access-grid">
          <div>
            <h3>Offene Anfragen</h3>
            {joinRequests.length
              ? <div className="join-request-list">
                  {joinRequests.map(request=><article key={request.id}>
                    <div>
                      <strong>{request.userName}</strong>
                      <span>@{request.username}</span>
                    </div>
                    <button onClick={()=>decideJoinRequest(request.id,'reject')} disabled={busy===`join-${request.id}`}>Ablehnen</button>
                    <button className="approve" onClick={()=>decideJoinRequest(request.id,'approve')} disabled={busy===`join-${request.id}`}>Annehmen</button>
                  </article>)}
                </div>
              : <p className="band-access-empty">Keine offenen Beitrittsanfragen.</p>
            }
          </div>

          <div>
            <h3>Aktive Einladungscodes</h3>
            {invites.filter(invite=>invite.active).length
              ? <div className="invite-list">
                  {invites.filter(invite=>invite.active).map(invite=><article key={invite.id}>
                    <code>{invite.code}</code>
                    <span>{invite.useCount}/{invite.maxUses} verwendet · gültig bis {new Date(invite.expiresAt).toLocaleDateString('de-DE')}</span>
                  </article>)}
                </div>
              : <p className="band-access-empty">Noch kein Einladungscode erstellt.</p>
            }
          </div>
        </div>
      </section>
    }

    {active&&
      <section className="panel band-members">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Gemeinsam</p>
            <h2>Mitglieder von {active.name}</h2>
          </div>
        </div>

        <div className="member-chips">
          {members.accounts.map(member=>
            <span key={`a-${member.id}`}>
              <b>{initials(member.name)}</b>
              <span>
                <strong>{member.name}</strong>
                <small>{member.role==='owner'?'Bandverwaltung':'Bandmitglied'}</small>
              </span>
            </span>
          )}
        </div>
      </section>
    }

    <section className="panel band-access-panel band-join-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Beitreten</p>
          <h2>Einer bestehenden Band beitreten</h2>
        </div>
      </div>

      <div className="band-access-grid">
        <div>
          <h3>Band suchen</h3>
          <div className="band-join-row">
            <input
              value={bandSearch}
              onChange={e=>setBandSearch(e.target.value)}
              onKeyDown={e=>{
                if(e.key==='Enter'){
                  e.preventDefault()
                  if(bandSearch.trim().length>=3)runBandSearch()
                }
              }}
              placeholder="Mindestens 3 Zeichen"
            />
            <button
              type="button"
              className="add-button compact"
              onClick={runBandSearch}
              disabled={busy==='search'||bandSearch.trim().length<3}
            >
              <Search size={17}/>{busy==='search'?'Sucht …':'Suchen'}
            </button>
          </div>

          {bandResults.length>0&&
            <div className="join-request-list band-join-results">
              {bandResults.map(band=>
                <article key={band.id}>
                  <div>
                    <strong>{band.name}</strong>
                    <span>{band.description||'Keine Beschreibung'}</span>
                  </div>
                  <button
                    type="button"
                    className="approve"
                    disabled={busy===`request-${band.id}`||bands.some(item=>item.id===band.id)}
                    onClick={()=>sendJoinRequest(band)}
                  >
                    {bands.some(item=>item.id===band.id)
                      ? 'Bereits Mitglied'
                      : busy===`request-${band.id}`?'Sendet …':'Anfrage senden'}
                  </button>
                </article>
              )}
            </div>
          }
        </div>

        <div>
          <h3>Einladungscode</h3>
          <div className="band-join-row">
            <input
              value={inviteCode}
              onChange={e=>setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}
              maxLength={8}
              placeholder="AB12CD34"
            />
            <button
              type="button"
              className="add-button compact"
              onClick={useInviteCode}
              disabled={busy==='code'||!inviteCode.trim()}
            >
              {busy==='code'?'Tritt bei …':'Beitreten'}
            </button>
          </div>
        </div>
      </div>

      {myRequests.length>0&&
        <div className="band-my-requests">
          <h3>Deine offenen Anfragen</h3>
          <div className="invite-list">
            {myRequests.map(request=>
              <article key={request.id}>
                <strong>{request.bandName}</strong>
                <span>Status: wartend auf Freigabe</span>
              </article>
            )}
          </div>
        </div>
      }

      {joinInfo&&<p className="band-join-info">{joinInfo}</p>}
    </section>
  </>
}

function formatDate(date) {
  if (!date) return 'Noch kein Datum'
  return new Intl.DateTimeFormat('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric'}).format(new Date(`${date}T12:00:00`))
}

function formatCompactDate(date) {
  if(!date)return 'Datum offen'
  return new Date(`${date}T12:00:00`).toLocaleDateString('de-DE',{day:'2-digit',month:'short'})
}

function initials(name) { const parts=name.trim().split(/\s+/).filter(Boolean);return parts.length>1?`${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase():(parts[0]?.slice(0,2).toUpperCase()||'') }

function TeamPage({team, onAdd, onDelete}) {
  const { t } = useI18n()
  return <><Header title={t('pages.team')} subtitle={t('pages.teamSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={onAdd}><Plus size={18}/>Teammitglied hinzufügen</button></div><section className="panel"><div className="panel-header"><div><p className="eyebrow">Band</p><h2>{team.length} {team.length===1?'Teammitglied':'Teammitglieder'}</h2></div></div>{team.length?<div className="team-grid">{team.map((member)=><article className="member-card" key={member.id}><div className="member-avatar">{member.hasPhoto?<AuthorizedImg path={memberPhoto(member)} alt=""/>:<span>{member.initials||initials(member.name)}</span>}</div><div className="member-info"><h3>{member.name} <small>{member.initials||initials(member.name)}</small></h3><p>{member.roles.join(' · ')||'Noch keine Aufgabe'}</p><div>{member.isLeader&&<span>Band-Leitung</span>}{member.isOrganizer&&<span>Organisation</span>}{member.isDesigner&&<span>Design & Plakate</span>}{member.isTechnician&&<span>Technik & Aufbau</span>}</div></div><button className="desktop-delete" onClick={()=>onDelete(member)} title="Teammitglied entfernen"><Trash2 size={18}/></button></article>)}</div>:<div className="empty-state"><Users size={38}/><h3>Euer Team beginnt hier</h3><p>Füge Sängerinnen, Musiker und organisatorische Rollen hinzu.</p><button className="add-button compact" onClick={onAdd}><Plus size={18}/>Erstes Mitglied hinzufügen</button></div>}</section></>
}

const roleOptions=['Gesang','Akustikgitarre','E-Gitarre','Bass','Piano / Keys','Drums','Percussion','Bläser','Streicher','Tontechnik','Lichttechnik','Songleitung','Organisation','Andere Aufgabe']
function TeamDialog({onClose,onSave}) {
  const [name,setName]=useState('');const [roles,setRoles]=useState([]);const [isLeader,setIsLeader]=useState(false);const [isOrganizer,setIsOrganizer]=useState(false);const [isDesigner,setIsDesigner]=useState(false);const [isTechnician,setIsTechnician]=useState(false);const [photo,setPhoto]=useState(null);const [preview,setPreview]=useState('');const [saving,setSaving]=useState(false)
  const toggle=(role)=>setRoles((current)=>current.includes(role)?current.filter((item)=>item!==role):[...current,role])
  return <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><section className="modal modal-wide"><div className="modal-header"><div><p className="eyebrow">Team</p><h2>Teammitglied hinzufügen</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><div className="member-form-head"><label className="photo-picker"><input type="file" accept="image/*" onChange={(event)=>{const file=event.target.files?.[0];if(file){setPhoto(file);setPreview(URL.createObjectURL(file))}}}/>{preview?<img src={preview} alt="Vorschau"/>:<><b>{name.trim()?initials(name):'+'}</b><span>Profilbild</span></>}</label><label className="field grow"><span>Name</span><div><Users size={18}/><input value={name} onChange={(event)=>setName(event.target.value)} placeholder="Vor- und Nachname" autoFocus/></div><small>Automatisches Kürzel: <strong>{name.trim()?initials(name):'–'}</strong></small></label></div><div className="role-field"><span>Instrumente und Aufgaben</span><div className="role-options">{roleOptions.map((role)=><button type="button" className={roles.includes(role)?'selected':''} onClick={()=>toggle(role)} key={role}>{role}</button>)}</div></div><div className="responsibility-options"><label><input type="checkbox" checked={isLeader} onChange={(event)=>setIsLeader(event.target.checked)}/><span><strong>Band-Leitung</strong><small>Leitet Team, Proben oder musikalische Abläufe</small></span></label><label><input type="checkbox" checked={isOrganizer} onChange={(event)=>setIsOrganizer(event.target.checked)}/><span><strong>Organisation</strong><small>Kümmert sich um Termine und Absprachen</small></span></label><label><input type="checkbox" checked={isDesigner} onChange={(event)=>setIsDesigner(event.target.checked)}/><span><strong>Design & Plakate</strong><small>Gestaltet Werbung für Lobpreis-Konzerte</small></span></label><label><input type="checkbox" checked={isTechnician} onChange={(event)=>setIsTechnician(event.target.checked)}/><span><strong>Technik & Aufbau</strong><small>Plant Ton, Mikrofone, Monitore und Kabel</small></span></label></div><div className="modal-actions"><button className="cancel-button" onClick={onClose}>Abbrechen</button><button className="add-button compact" disabled={!name.trim()||saving} onClick={async()=>{setSaving(true);try{await onSave({name:name.trim(),roles,isLeader,isOrganizer,isDesigner,isTechnician,photo})}finally{setSaving(false)}}}><Plus size={18}/>{saving?'Speichert…':'Hinzufügen'}</button></div></section></div>
}

const appointmentTypes={rehearsal:'Bandprobe',planning:'Planungstreffen',soundcheck:'Technik & Soundcheck',other:'Sonstiger Termin'}
function AppointmentsPage({sets,appointments,onAdd,onDelete,navigate}) {
  const sortedSets=[...sets].sort((a,b)=>a.date.localeCompare(b.date))
  const { t } = useI18n()
  return <><Header title={t('pages.appointments')} subtitle={t('pages.appointmentsSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={()=>onAdd()} disabled={!sets.length}><Plus size={18}/>Termin anlegen</button></div>{sortedSets.length?sortedSets.map((set)=>{const rehearsals=appointments.filter((item)=>item.setId===set.id).sort((a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));const place=[set.band,set.venue].filter(Boolean).join(' in ')||'Ort noch offen';return <section className="panel concert-block" key={set.id}><div className="concert-head"><div className="concert-date"><strong>{formatCompactDate(set.date)}</strong><span>{set.eventTime?`${set.eventTime} Uhr`:'Beginn offen'}</span></div><div className="concert-dot"/><div className="concert-copy"><span>Konzert</span><h2>{set.theme||set.title}</h2><p>{place}</p><button className="text-button" onClick={()=>navigate(`/sets/${set.id}`)}>Set öffnen →</button></div></div><div className="rehearsal-section"><div className="rehearsal-head"><div><p className="eyebrow">Vorbereitung</p><h3>Geplante Bandproben</h3></div><button className="add-button compact" onClick={()=>onAdd(set.id)}><Plus size={17}/>Bandprobe hinzufügen</button></div>{rehearsals.length?<div className="rehearsal-list">{rehearsals.map((item)=><article key={item.id}><div className="rehearsal-date"><strong>{new Date(`${item.date}T12:00:00`).toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})}</strong><span>{item.time?`${item.time} Uhr`:'Zeit offen'}</span></div><div><b>{item.title}</b><p>{item.location||place}{item.notes&&` · ${item.notes}`}</p></div><button className="desktop-delete" onClick={()=>onDelete(item)} title="Termin löschen"><Trash2 size={17}/></button></article>)}</div>:<div className="no-rehearsals"><CalendarDays size={24}/><div><strong>Noch keine Bandprobe geplant</strong><span>Lege hier Proben und weitere Vorbereitungstermine mit Datum und Uhrzeit an.</span></div></div>}</div></section>}):<section className="panel"><div className="empty-state"><CalendarDays size={38}/><h3>Noch keine Sets</h3><p>Lege zuerst ein Set an. Danach kannst du alle zugehörigen Proben planen.</p></div></section>}</>
}

function AppointmentDialog({sets,initialSetId,onClose,onSave}) {
  const initialSet=sets.find((set)=>set.id===initialSetId);const [setId,setSetId]=useState(initialSetId||sets[0]?.id||'');const [type,setType]=useState('rehearsal');const [title,setTitle]=useState('Bandprobe');const [date,setDate]=useState('');const [time,setTime]=useState('19:30');const [location,setLocation]=useState([initialSet?.band,initialSet?.venue].filter(Boolean).join(' in '));const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false)
  return <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><section className="modal"><div className="modal-header"><div><p className="eyebrow">Set-Termin</p><h2>Termin anlegen</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><label className="field"><span>Zugehöriges Set</span><div><ListMusic size={18}/><select value={setId} onChange={(event)=>setSetId(event.target.value)}>{sets.map((set)=><option value={set.id} key={set.id}>{set.title} · {formatDate(set.date)}</option>)}</select></div></label><label className="field"><span>Art des Termins</span><div><CalendarDays size={18}/><select value={type} onChange={(event)=>{setType(event.target.value);setTitle(appointmentTypes[event.target.value])}}>{Object.entries(appointmentTypes).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div></label><label className="field"><span>Titel</span><div><FileText size={18}/><input value={title} onChange={(event)=>setTitle(event.target.value)}/></div></label><div className="dialog-columns"><label className="field"><span>Datum</span><div><CalendarDays size={18}/><input type="date" value={date} onChange={(event)=>setDate(event.target.value)}/></div></label><label className="field"><span>Uhrzeit</span><div><Clock3 size={18}/><input type="time" value={time} onChange={(event)=>setTime(event.target.value)}/></div></label></div><label className="field"><span>Ort</span><div><Home size={18}/><input value={location} onChange={(event)=>setLocation(event.target.value)} placeholder="Proberaum, Kirche …"/></div></label><label className="field"><span>Notizen</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Was soll geprobt oder vorbereitet werden?"/></label><div className="modal-actions"><button className="cancel-button" onClick={onClose}>Abbrechen</button><button className="add-button compact" disabled={!setId||!title.trim()||!date||saving} onClick={async()=>{setSaving(true);try{await onSave({setId,type,title:title.trim(),date,time,location,notes})}finally{setSaving(false)}}}><Plus size={18}/>{saving?'Speichert…':'Termin speichern'}</button></div></section></div>
}

function SetsPage({sets, onCreate, navigate}) {
  return <><Header title="Sets" subtitle="Plane die Reihenfolge für Probe, Gottesdienst oder Auftritt."/><div className="page-actions"><button className="add-button compact" onClick={onCreate}><Plus size={18}/>Neues Set planen</button></div>
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">Setplanung</p><h2>{sets.length} {sets.length === 1 ? 'Set' : 'Sets'}</h2></div></div>
      {sets.length ? <div className="set-library">{sets.map((set) => <button className="set-library-card" key={set.id} onClick={() => navigate(`/sets/${set.id}`)}><div className="set-date">{formatDate(set.date)}</div><h3>{set.title}</h3><p>{set.songIds.length} {set.songIds.length === 1 ? 'Song' : 'Songs'}</p><span>Set planen <ChevronRight size={17}/></span></button>)}</div> : <div className="empty-state"><ListMusic size={36}/><h3>Plane dein erstes Set</h3><p>Füge deine importierten PDFs hinzu und bringe die Songs in die richtige Reihenfolge.</p><button className="add-button compact" onClick={onCreate}><Plus size={18}/>Set anlegen</button></div>}
    </section></>
}

function CreateSetDialog({onClose, onCreate}) {
  const [title, setTitle] = useState('Bandprobe')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [eventTime, setEventTime] = useState('')
  const [arrivalTime, setArrivalTime] = useState('')
  const [band, setBand] = useState('')
  const [theme, setTheme] = useState('')
  const [venue, setVenue] = useState('')
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">Setplanung</p><h2>Neues Set</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <label className="field"><span>Name des Sets</span><div><ListMusic size={18}/><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus/></div></label>
    <label className="field"><span>Band / Projekt</span><div><Users size={18}/><input value={band} onChange={(e)=>setBand(e.target.value)} placeholder="z. B. Worship-Team"/></div></label>
    <label className="field"><span>Thema</span><div><FileText size={18}/><input value={theme} onChange={(e)=>setTheme(e.target.value)} placeholder="z. B. Jahreskonzert"/></div></label>
    <label className="field"><span>Veranstaltungsort</span><div><Home size={18}/><input value={venue} onChange={(e)=>setVenue(e.target.value)} placeholder="Kirche / Veranstaltungsort"/></div></label>
    <label className="field"><span>Datum</span><div><CalendarDays size={18}/><input type="date" value={date} onChange={(e) => setDate(e.target.value)}/></div></label>
    <label className="field"><span>Beginn / Uhrzeit</span><div><Clock3 size={18}/><input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)}/></div></label>
    <label className="field"><span>Treffen / Aufbau ab</span><div><Clock3 size={18}/><input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)}/></div></label>
    <div className="modal-actions"><button className="cancel-button" onClick={onClose}>Abbrechen</button><button className="add-button compact" disabled={!title.trim()} onClick={() => onCreate({title: title.trim(), date, eventTime, arrivalTime, band, theme, venue})}><Plus size={18}/>Set anlegen</button></div>
  </section></div>
}

function SetDetailPage({sets, songs, team, updateSets, navigate}) {
  const {setId} = useParams()
  const set = sets.find((item) => item.id === setId)
  const [running, setRunning] = useState(false)
  if (!set) return <SimplePage eyebrow="Setplanung" title="Set nicht gefunden" text="Dieses Set existiert nicht oder wurde entfernt."/>
  const setSongs = set.songIds.map((id) => songs.find((song) => song.id === id)).filter(Boolean)
  const available = songs.filter((song) => !set.songIds.includes(song.id))
  const update = (changes) => { const next={...set,...changes}; updateSets((current) => current.map((item) => item.id === set.id ? next : item)); saveSet(next).catch(console.error) }
  const addSong = (id) => { const song=songs.find((item)=>item.id===id);update({songIds: [...set.songIds, id],songKeys:{...(set.songKeys||{}),...(song?.preferredKey?{[id]:song.preferredKey}:{})}}) }
  const removeSong = (index) => { const songId=set.songIds[index];const songKeys={...(set.songKeys||{})};delete songKeys[songId];const leaders={...(set.leaders||{})};delete leaders[songId];update({songIds: set.songIds.filter((_, itemIndex) => itemIndex !== index),songKeys,leaders}) }
  const moveSong = (index, offset) => { const next = [...set.songIds]; const target = index + offset; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; update({songIds: next}) }
  const assignLeader = (songId, memberId) => update({leaders: {...(set.leaders || {}), [songId]: memberId}})
  const assignSongKey = (songId, key) => update({songKeys: {...(set.songKeys || {}), [songId]: key}})
  return <><button className="back-button" onClick={() => navigate('/sets')}><ChevronLeft size={18}/>Alle Sets</button><Header title={set.title} subtitle={`${formatDate(set.date)} · ${setSongs.length} Songs`}/>
    <div className="set-toolbar"><button className="run-button" disabled={!setSongs.length} onClick={() => setRunning(true)}><Play size={19}/>Set starten</button><span>Änderungen werden automatisch gespeichert.</span>{!set.isProtected&&<button className="delete-set-button" onClick={async () => { if (!window.confirm(`Set „${set.title}“ wirklich löschen? Die PDFs bleiben in der Bibliothek.`)) return; await deleteSet(set.id); updateSets((current) => current.filter((item) => item.id !== set.id)); navigate('/sets') }}><Trash2 size={17}/>Set löschen</button>}</div>
    <section className="panel event-details"><div className="panel-header"><div><p className="eyebrow">Veranstaltung</p><h2>Rahmendaten</h2></div></div><div className="briefing-grid"><label className="field"><span>Band / Projekt</span><div><Users size={18}/><input value={set.band||''} onChange={(event)=>update({band:event.target.value})} placeholder="z. B. Worship-Team"/></div></label><label className="field"><span>Thema</span><div><FileText size={18}/><input value={set.theme||''} onChange={(event)=>update({theme:event.target.value})} placeholder="z. B. Jahreskonzert"/></div></label><label className="field"><span>Ort</span><div><Home size={18}/><input value={set.venue||''} onChange={(event)=>update({venue:event.target.value})} placeholder="Kirche / Veranstaltungsort"/></div></label><label className="field"><span>Datum</span><div><CalendarDays size={18}/><input type="date" value={set.date||''} onChange={(event)=>update({date:event.target.value})}/></div></label><label className="field"><span>Treffen / Aufbau</span><div><Clock3 size={18}/><input type="time" value={set.arrivalTime||''} onChange={(event)=>update({arrivalTime:event.target.value})}/></div></label><label className="field"><span>Konzertbeginn</span><div><Clock3 size={18}/><input type="time" value={set.eventTime||''} onChange={(event)=>update({eventTime:event.target.value})}/></div></label></div></section>
    <div className="planner-grid"><section className="panel planner-panel"><div className="panel-header"><div><p className="eyebrow">Ablauf</p><h2>Reihenfolge im Set</h2></div></div>
      {setSongs.length ? <div className="planned-songs">{setSongs.map((song, index) => { const leaderId=set.leaders?.[song.id]||'';const leader=team.find((member)=>member.id===leaderId);const selectedKey=set.songKeys?.[song.id]||'';return <div className="planned-song" key={`${song.id}-${index}`}><span className="order-number">{index + 1}</span><div className="song-main"><strong>{song.title}</strong><span>{song.artist}{selectedKey?` · Tonart ${selectedKey}`:hasSongPdf(song)?' · Original-PDF':''}</span></div><div className="set-song-options"><label className="leader-select">{leader&&<b>{leader.initials||initials(leader.name)}</b>}{leaderId==='group'&&<b>ALL</b>}<select value={leaderId} onChange={(event)=>assignLeader(song.id,event.target.value)}><option value="">Leitung wählen</option><option value="group">Alle gemeinsam</option>{team.map((member)=><option value={member.id} key={member.id}>{member.name} ({member.initials||initials(member.name)})</option>)}</select></label><label className="set-key-select"><select value={selectedKey} onChange={(event)=>assignSongKey(song.id,event.target.value)}><option value="">Original-PDF</option>{(song.variantKeys||[]).map((key)=><option value={key} key={key}>Tonart {key}</option>)}</select></label></div><div className="order-actions"><button className="icon-button" disabled={index === 0} onClick={() => moveSong(index, -1)}><ArrowUp size={17}/></button><button className="icon-button" disabled={index === setSongs.length - 1} onClick={() => moveSong(index, 1)}><ArrowDown size={17}/></button>{selectedKey?<button className="icon-button" onClick={()=>openSongChart(song,selectedKey)} title={`Fassung ${selectedKey} öffnen`}><Eye size={17}/></button>:hasSongPdf(song) && <button className="icon-button" onClick={() => openSongPdf(song)} title="PDF öffnen"><Eye size={17}/></button>}<button className="icon-button danger" onClick={() => removeSong(index)}><Trash2 size={17}/></button></div></div>})}</div> : <div className="empty-state small"><Music2 size={30}/><h3>Noch keine Songs</h3><p>Füge rechts Songs aus deiner Bibliothek hinzu.</p></div>}
    </section><section className="panel planner-panel"><div className="panel-header"><div><p className="eyebrow">Bibliothek</p><h2>Songs hinzufügen</h2></div></div>
      <div className="available-songs">{available.map((song) => <button key={song.id} onClick={() => addSong(song.id)}><div><strong>{song.title}</strong><span>{song.artist}{hasSongPdf(song) ? ' · PDF' : ''}</span></div><Plus size={18}/></button>)}{!available.length && <p className="empty">Alle Songs sind bereits im Set.</p>}</div>
    </section></div><section className="panel tech-briefing"><div className="panel-header"><div><p className="eyebrow">Veranstaltungstechnik</p><h2>Technik-Briefing</h2></div></div><div className="briefing-grid"><label className="field"><span>Zuständig</span><div><Users size={18}/><select value={set.technicianId||''} onChange={(event)=>update({technicianId:event.target.value})}><option value="">Technik auswählen</option>{team.filter((member)=>member.isTechnician||member.roles.includes('Tontechnik')).map((member)=><option value={member.id} key={member.id}>{member.name}</option>)}</select></div></label><label className="field"><span>Datum und Beginn</span><div><CalendarDays size={18}/><input value={`${formatDate(set.date)}${set.eventTime?` · ${set.eventTime} Uhr`:''}`} readOnly/></div></label><label className="field briefing-notes"><span>Mikrofone, Monitore, Kabel, Aufbau und weitere Hinweise</span><textarea value={set.techNotes||''} onChange={(event)=>update({techNotes:event.target.value})} placeholder="z. B. 4 Gesangsmikrofone, 3 Monitore, DI-Boxen, benötigte Kabel, Aufbau ab 17:00 Uhr …"/></label></div></section>
    {running && <RunSet set={set} songs={setSongs} onClose={() => setRunning(false)}/>}</>
}

function RunSet({set, songs, onClose}) {
  const [index, setIndex] = useState(0)
  const touchStart = useRef(null)
  const song = songs[index]
  const selectedKey = set.songKeys?.[song.id] || ''
  const previous = () => setIndex((current) => Math.max(0, current - 1))
  const next = () => setIndex((current) => Math.min(songs.length - 1, current + 1))
  useEffect(() => {
    const handleKey = (event) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); setIndex((current) => Math.min(songs.length - 1, current + 1)) }
      if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)) }
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [songs.length, onClose])
  const finishSwipe = (clientX) => {
    if (touchStart.current === null) return
    const distance = clientX - touchStart.current
    if (distance < -55) next()
    if (distance > 55) previous()
    touchStart.current = null
  }
  return <div className="run-mode"><header><div><p className="eyebrow">Probe läuft · Wischen oder Fußpedal</p><strong>{set.title}</strong><span>{index + 1}/{songs.length} · {song.title}{selectedKey?` · Tonart ${selectedKey}`:''}</span></div><button className="icon-button" onClick={onClose}><X size={22}/></button></header>
    <main className="pdf-stage" onTouchStart={(event) => { touchStart.current = event.touches[0].clientX }} onTouchEnd={(event) => finishSwipe(event.changedTouches[0].clientX)}>
      {selectedKey ? <AuthorizedFrame key={`${song.id}-${selectedKey}`} title={`${song.title} – ${selectedKey}`} path={songChartUrl(song,selectedKey)}/> : hasSongPdf(song) ? <AuthorizedFrame key={song.id} title={song.title} path={songPdfUrl(song)} hash="#toolbar=0&navpanes=0&view=FitH"/> : <div className="no-pdf"><FileText size={42}/><strong>{song.title}</strong><span>Für diesen Song ist keine PDF hinterlegt.</span></div>}
      <button className="stage-arrow left" disabled={index === 0} onClick={previous} aria-label="Vorheriger Song"><ChevronLeft size={32}/></button><button className="stage-arrow right" disabled={index === songs.length - 1} onClick={next} aria-label="Nächster Song"><ChevronRight size={32}/></button>
    </main><footer><button disabled={index === 0} onClick={previous}><ChevronLeft size={21}/>Zurück</button><div>{songs.map((item, itemIndex) => <span className={itemIndex === index ? 'active' : ''} key={`${item.id}-${itemIndex}`}/>)}</div><button disabled={index === songs.length - 1} onClick={next}>Weiter<ChevronRight size={21}/></button></footer></div>
}

function EditSongDialog({song, onClose, onSave}) {
  const [title, setTitle] = useState(song.title)
  const [key, setKey] = useState(song.key === '–' ? '' : song.key || '')
  const [saving, setSaving] = useState(false)
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">Song bearbeiten</p><h2>Angaben ändern</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <label className="field"><span>Songtitel</span><div><FileText size={18}/><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus/></div></label>
    <label className="field"><span>Tonart</span><div><Music2 size={18}/><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="z. B. D, Em oder F#"/></div></label>
    <div className="modal-actions"><button className="cancel-button" onClick={onClose} disabled={saving}>Abbrechen</button><button className="add-button compact" disabled={!title.trim() || saving} onClick={async () => { setSaving(true); try { await onSave({title: title.trim(), artist: song.artist, key: key.trim() || '–'}) } finally { setSaving(false) } }}><CheckCircle2 size={18}/>{saving ? 'Speichert…' : 'Änderungen speichern'}</button></div>
  </section></div>
}

function SongEditorRoute({songs,setSongs,navigate}) {
  const {songId}=useParams();const song=songs.find((item)=>item.id===songId)
  if(!song)return <SimplePage eyebrow="Song-Editor" title="Song nicht gefunden" text="Dieser Song ist nicht mehr in der Bibliothek."/>
  return <TransposeDialog embedded song={song} onClose={()=>navigate('/songs')} onSave={async(values)=>{const variant=await saveSongVariant(song.id,values);setSongs((current)=>current.map((item)=>item.id===song.id?{...item,key:variant.targetKey,sourceKey:variant.sourceKey,preferredKey:variant.targetKey,variantKeys:Array.from(new Set([variant.targetKey,...(item.variantKeys||[])]))}:item));return variant}}/>
}

const germanKeys=['C','Cis','D','Es','E','F','Fis','G','As','A','Bb','B']
const editorPitchMap={C:0,Cis:1,'C#':1,Des:1,Db:1,D:2,Dis:3,'D#':3,Es:3,Eb:3,E:4,F:5,Fis:6,'F#':6,Ges:6,Gb:6,G:7,Gis:8,'G#':8,As:8,Ab:8,A:9,Ais:10,'A#':10,Bb:10,B:11,H:11}
const editorSharpNames=['C','Cis','D','Dis','E','F','Fis','G','Gis','A','Ais','B']
const editorFlatNames=['C','Des','D','Es','E','F','Ges','G','As','A','Bb','B']
const editorChordPattern=/(?<![\p{L}\d])(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])((?:m|maj|min|dim|aug|sus|add)?\d*(?:sus\d*)?(?:[#b+°-]\d*)*(?:\/(?:Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH]))?)(?![\p{L}\d])/gu
const editorChordTokens=(line)=>[...line.matchAll(new RegExp(editorChordPattern.source,'gu'))]
const isEditorChordLine=(line)=>{const matches=editorChordTokens(line);if(!matches.length)return false;return line.replace(new RegExp(editorChordPattern.source,'gu'),'').replace(/[\s|,:()[\]{}-]/g,'').length===0}
function transposeEditorText(text,fromKey,toKey){const shift=editorPitchMap[toKey]-editorPitchMap[fromKey];if(!shift)return text;const useFlat=['F','Bb','Es','As','Des','Ges'].includes(toKey);const root=(value)=>{const idx=(editorPitchMap[value]+shift+120)%12;if(idx===10&&(useFlat||['C','G','D'].includes(toKey)))return 'Bb';return (useFlat?editorFlatNames:editorSharpNames)[idx]};return text.split('\n').map((line)=>isEditorChordLine(line)?line.replace(editorChordPattern,(full,note,suffix)=>{const slash=suffix.match(/\/(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])$/);return root(note)+(slash?suffix.slice(0,-slash[0].length)+'/'+root(slash[1]):suffix)}):line).join('\n')}
function TransposeDialog({song,onClose,onSave,embedded=false,homeEmbedded=false}) {
  const initialKey=germanKeys.includes(song.sourceKey||song.key)?(song.sourceKey||song.key):'D';const [text,setText]=useState('');const [sourceKey]=useState(initialKey);const [targetKey,setTargetKey]=useState(initialKey);const [currentKey,setCurrentKey]=useState(initialKey);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [saved,setSaved]=useState('');const [fontSize,setFontSize]=useState(16);const [columns,setColumns]=useState(1);const [autoScroll,setAutoScroll]=useState(false);const [bpm,setBpm]=useState(120);const [cajonOn,setCajonOn]=useState(false);const audioContextRef=useRef(null);const [view,setView]=useState(hasSongPdf(song)?'original':'edited')
  useEffect(()=>{analyzeSongChords(song.id).then((data)=>{setText(data.text);const tempo=data.text.match(/TEMPO:\s*(\d{2,3})\s*BPM/i);if(tempo)setBpm(Math.min(240,Math.max(40,Number(tempo[1]))));setLoading(false)}).catch((caught)=>{setError(caught.message);setLoading(false)})},[song.id])
  useEffect(()=>{if(!autoScroll)return;const timer=window.setInterval(()=>window.scrollBy({top:1,behavior:'auto'}),70);return()=>window.clearInterval(timer)},[autoScroll])
  useEffect(()=>{if(!cajonOn)return;const AudioContext=window.AudioContext||window.webkitAudioContext;const context=audioContextRef.current||new AudioContext();audioContextRef.current=context;context.resume();let beat=0;const strike=()=>{const now=context.currentTime;const strong=beat%4===0;const master=context.createGain();master.gain.setValueAtTime(strong?.11:.045,now);master.gain.exponentialRampToValueAtTime(.001,now+(strong?.14:.075));master.connect(context.destination);const length=Math.floor(context.sampleRate*(strong?.14:.075));const buffer=context.createBuffer(1,length,context.sampleRate);const data=buffer.getChannelData(0);for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*(1-i/length);const noise=context.createBufferSource();const filter=context.createBiquadFilter();filter.type='bandpass';filter.frequency.value=strong?720:1750;filter.Q.value=strong?.8:1.4;noise.buffer=buffer;noise.connect(filter);filter.connect(master);noise.start(now);if(strong){const tone=context.createOscillator();const toneGain=context.createGain();tone.frequency.setValueAtTime(115,now);tone.frequency.exponentialRampToValueAtTime(58,now+.11);toneGain.gain.setValueAtTime(.09,now);toneGain.gain.exponentialRampToValueAtTime(.001,now+.13);tone.connect(toneGain);toneGain.connect(context.destination);tone.start(now);tone.stop(now+.14)}beat+=1};strike();const timer=window.setInterval(strike,60000/bpm);return()=>window.clearInterval(timer)},[cajonOn,bpm])
  useEffect(()=>()=>{audioContextRef.current?.close()},[])
  const changeTargetKey=(next)=>{setText((current)=>transposeEditorText(current,currentKey,next));setCurrentKey(next);setTargetKey(next)}
  const saveEditor=async()=>{setSaving(true);setSaved('');try{await onSave({text:transposeEditorText(text,currentKey,sourceKey),sourceKey,targetKey});setSaved(`Fassung in ${targetKey} gespeichert`)}finally{setSaving(false)}}
  const originalUrl=songPdfUrl(song);const share=async()=>{const data=view==='original'?{title:song.title,url:new URL(originalUrl,window.location.origin).href}:{title:song.title,text:`${song.title}\n\n${text}`};if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url||data.text);setSaved('In die Zwischenablage kopiert')}}
  const download=async()=>{const link=document.createElement('a');if(view==='original'){try{const href=await authorizedObjectUrl(originalUrl);link.href=href;link.download=song.fileName||`${song.title}.pdf`;link.click();if(href.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(href),30000)}catch{link.href=originalUrl;link.download=song.fileName||`${song.title}.pdf`;link.click()}}else{link.href=URL.createObjectURL(new Blob([`${song.title}\n\n${text}`],{type:'text/plain;charset=utf-8'}));link.download=`${song.title}.txt`;link.click();URL.revokeObjectURL(link.href)}}
  const printSheet=async()=>{if(view==='original'){try{const href=await authorizedObjectUrl(originalUrl);window.open(`${href}#toolbar=1`,'_blank','noopener')}catch{window.open(`${originalUrl}#toolbar=1`,'_blank','noopener')}}else window.print()}
  return <div className={`${embedded?'song-editor-page':'modal-backdrop'}${homeEmbedded?' home-song-editor':''}`} onMouseDown={(event)=>!embedded&&event.target===event.currentTarget&&onClose()}>{embedded&&<button className="back-button editor-back" onClick={onClose}><ChevronLeft size={18}/>Zur Bibliothek</button>}<section className={embedded?'song-editor-surface':'modal modal-wide transpose-modal'}>{loading?<div className="analysis-loading"><Music2 size={30}/><strong>Lied wird vorbereitet …</strong></div>:error?<div className="form-error analysis-error">{error}</div>:<><div className="editor-view-switch"><button className={view==='original'?'active':''} onClick={()=>setView('original')} disabled={!hasSongPdf(song)}>Original-PDF</button><button className={view==='edited'?'active':''} onClick={()=>setView('edited')}>Tonart bearbeiten</button><span>{view==='original'?'Unverändertes importiertes Dokument mit Logo und Lizenzangaben':'Automatisch ausgelesene, bearbeitbare Fassung'}</span></div><div className="sheet-toolbar"><label className={view==='original'?'tool-disabled':''}><span>Tonart ändern</span><select disabled={view==='original'} value={targetKey} onChange={(event)=>changeTargetKey(event.target.value)}>{germanKeys.map((key)=><option key={key}>{key}</option>)}</select></label><div className={`tool-group${view==='original'?' tool-disabled':''}`}><span>Spalten</span><button disabled={view==='original'} className={columns===1?'active':''} onClick={()=>setColumns(1)}>1</button><button disabled={view==='original'} className={columns===2?'active':''} onClick={()=>setColumns(2)}><Columns2 size={18}/></button></div><div className={`tool-group font-tools${view==='original'?' tool-disabled':''}`}><span>Schrift</span><button disabled={view==='original'} onClick={()=>setFontSize((size)=>Math.max(11,size-1))}>−</button><Type size={18}/><button disabled={view==='original'} onClick={()=>setFontSize((size)=>Math.min(28,size+1))}>+</button><button disabled={view==='original'} onClick={()=>setFontSize(16)} title="Schrift zurücksetzen"><RotateCcw size={17}/></button></div><div className="tool-group scroll-tool"><span>Auto-Scroll</span><button className={autoScroll?'active':''} onClick={()=>setAutoScroll((value)=>!value)}>{autoScroll?<Pause size={18}/>:<Play size={18}/>}</button></div><div className="tool-group cajon-tool"><span>BPM / Cajón</span><input aria-label="Tempo in BPM" type="number" min="40" max="240" value={bpm} onChange={(event)=>setBpm(Math.min(240,Math.max(40,Number(event.target.value)||40)))}/><button className={cajonOn?'active':''} onClick={()=>setCajonOn((value)=>!value)} title="Sanften Cajón-Takt starten">{cajonOn?<Pause size={18}/>:<Play size={18}/>}</button></div><div className="tool-group sheet-actions"><span>Notenblatt</span><button onClick={printSheet} title="Drucken"><Printer size={18}/></button><button onClick={download} title="Herunterladen"><Download size={18}/></button><button onClick={share} title="Teilen"><Share2 size={18}/></button><button onClick={()=>document.documentElement.requestFullscreen?.()} title="Vollbild"><Maximize2 size={18}/></button></div></div>{view==='original'?<div className="original-pdf-sheet"><AuthorizedFrame title={`${song.title} – Original-PDF`} path={originalUrl} hash="#toolbar=0&navpanes=0&view=FitH"/></div>:<><article className="editor-paper"><header><div><h2>{song.title}</h2><p>{song.artist||'Worship Songbook'}</p><strong>Bearbeitete Fassung · Tonart: {targetKey}</strong></div><Music2 size={30}/></header><pre className={`chart-sheet columns-${columns}`} style={{fontSize}} contentEditable suppressContentEditableWarning spellCheck="false" onBlur={(event)=>{setText(event.currentTarget.innerText);setSaved('')}}>{text}</pre></article><div className="editor-bottom-actions">{saved&&<span className="editor-saved"><CheckCircle2 size={16}/>{saved}</span>}<button className="add-button compact" disabled={!text.trim()||saving} onClick={saveEditor}><CheckCircle2 size={18}/>{saving?'Speichert …':`Bearbeitete Fassung in ${targetKey} speichern`}</button></div></>}</>}</section></div>
}

function ScanDialog({onClose,onSave}) {
  const cameraRef=useRef(null);const galleryRef=useRef(null);const [title,setTitle]=useState('');const [pages,setPages]=useState([]);const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const add=files=>{const next=Array.from(files||[]).filter(file=>file.type.startsWith('image/'));if(!next.length)return;setPages(current=>[...current,...next.slice(0,8-current.length).map(file=>({id:crypto.randomUUID(),file,url:URL.createObjectURL(file)}))])}
  const remove=id=>setPages(current=>{const page=current.find(item=>item.id===id);if(page)URL.revokeObjectURL(page.url);return current.filter(item=>item.id!==id)})
  const move=(index,offset)=>setPages(current=>{const target=index+offset;if(target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next})
  return <div className="modal-backdrop"><section className="modal modal-wide scan-modal"><div className="modal-header"><div><p className="eyebrow">Dokument-Scanner</p><h2>Buchseiten scannen</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><div className="scan-guide"><span>1</span><p><strong>Seite gerade und vollständig fotografieren</strong><small>Gutes Licht, keine Finger oder Schatten und möglichst direkt von oben.</small></p></div><input ref={cameraRef} className="file-input" type="file" accept="image/*" capture="environment" onChange={event=>{add(event.target.files);event.target.value=''}}/><input ref={galleryRef} className="file-input" type="file" accept="image/*" multiple onChange={event=>{add(event.target.files);event.target.value=''}}/><div className="scan-actions"><button className="scan-camera-button" onClick={()=>cameraRef.current?.click()}><FileText size={24}/><span><strong>{pages.length?'Nächste Seite scannen':'Kamera öffnen'}</strong><small>Bis zu 8 Seiten</small></span></button><button className="scan-gallery-button" onClick={()=>galleryRef.current?.click()}><Upload size={21}/>Bilder auswählen</button></div>{pages.length>0&&<><label className="field scan-title"><span>Songtitel</span><div><Music2 size={18}/><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Titel des Liedes" autoFocus/></div></label><div className="scan-pages">{pages.map((page,index)=><article key={page.id}><img src={page.url} alt={`Scan-Seite ${index+1}`}/><span>Seite {index+1}</span><div><button disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button disabled={index===pages.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button onClick={()=>remove(page.id)}><Trash2 size={16}/></button></div></article>)}</div></>}{error&&<p className="form-error">{error}</p>}<div className="scan-processing-note"><CheckCircle2 size={18}/><span><strong>Automatische Aufbereitung</strong><small>Die Seiten werden ausgerichtet, kontrastiert, als Original-PDF gespeichert und danach in eine bearbeitbare Text- und Akkordfassung umgewandelt.</small></span></div><div className="modal-actions"><button className="cancel-button" onClick={onClose} disabled={saving}>Zurück</button><button className="add-button compact" disabled={!title.trim()||!pages.length||saving} onClick={async()=>{setSaving(true);setError('');try{await onSave(title.trim(),pages)}catch(e){setError(e.message);setSaving(false)}}}><Upload size={18}/>{saving?'Scan wird vorbereitet …':'Scannen und Lead-Sheet erstellen'}</button></div></section></div>
}

function ImportDialog({onClose, onImport, onScan}) {
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [progress, setProgress] = useState(0)
  const [scanOpen,setScanOpen]=useState(false)
  const choose = (selectedFiles) => {
    const files = Array.from(selectedFiles || [])
    if (!files.length) return
    const invalid = files.find((file) => (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) || file.size > 20 * 1024 * 1024)
    if (invalid) { setError(`${invalid.name}: Bitte nur PDFs bis maximal 20 MB auswählen.`); return }
    setError('')
    setItems((current) => {
      const existing = new Set(current.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`))
      const additions = files.filter((file) => !existing.has(`${file.name}-${file.size}-${file.lastModified}`)).map((file) => ({ id: crypto.randomUUID(), file, title: file.name.replace(/\.pdf$/i, '') }))
      return [...current, ...additions]
    })
    if (inputRef.current) inputRef.current.value = ''
  }
  const updateTitle = (id, title) => setItems((current) => current.map((item) => item.id === id ? {...item, title} : item))
  const move = (index, offset) => setItems((current) => { const next = [...current]; const target = index + offset; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next })
  const remove = (id) => setItems((current) => current.filter((item) => item.id !== id))
  const valid = items.length > 0 && items.every((item) => item.title.trim())
  if(scanOpen)return <ScanDialog onClose={()=>setScanOpen(false)} onSave={onScan}/>
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="modal-header"><div><p className="eyebrow">Neue Songs</p><h2 id="import-title">Mehrere PDFs importieren</h2></div><button className="icon-button" onClick={onClose} aria-label="Schließen"><X size={20}/></button></div>
      <p className="modal-copy">Wähle alle Songs deines Sets auf einmal und bringe sie vor dem Import in die richtige Reihenfolge.</p>
      <div className="import-methods"><button className="scan-start" onClick={()=>setScanOpen(true)}><span><FileText size={23}/></span><div><strong>Aus einem Buch scannen</strong><small>Kamera öffnen · mehrere Seiten · automatisch vorbereiten</small></div><ChevronRight size={18}/></button><span>oder vorhandene PDFs auswählen</span></div>
      <input ref={inputRef} className="file-input" type="file" multiple accept="application/pdf,.pdf" onChange={(e) => choose(e.target.files)}/>
      <button className={`dropzone batch-dropzone${items.length ? ' has-file' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files) }}>
        {items.length ? <><CheckCircle2 size={26}/><strong>{items.length} {items.length === 1 ? 'PDF ausgewählt' : 'PDFs ausgewählt'}</strong><span>Weitere PDFs hinzufügen</span></> : <><Upload size={30}/><strong>Alle PDFs hierher ziehen</strong><span>oder klicken und mehrere Dateien auswählen · je max. 20 MB</span></>}
      </button>
      {(error || saveError) && <p className="form-error">{error || saveError}</p>}
      {items.length > 0 && <div className="import-list"><div className="import-list-head"><strong>Reihenfolge im Set</strong><span>Mit den Pfeilen sortieren</span></div>{items.map((item, index) => <div className="import-item" key={item.id}><span className="order-number">{index + 1}</span><FileText className="import-file-icon" size={19}/><div className="import-title"><input value={item.title} onChange={(e) => updateTitle(item.id, e.target.value)} aria-label={`Titel von ${item.file.name}`}/><span>{item.file.name} · {(item.file.size / 1024 / 1024).toFixed(2)} MB</span></div><div className="order-actions"><button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} title="Nach oben"><ArrowUp size={17}/></button><button className="icon-button" disabled={index === items.length - 1} onClick={() => move(index, 1)} title="Nach unten"><ArrowDown size={17}/></button><button className="icon-button danger" onClick={() => remove(item.id)} title="Entfernen"><Trash2 size={17}/></button></div></div>)}</div>}
      {saving && <div className="save-progress"><span style={{width: `${progress}%`}}/><small>PDFs werden lokal gespeichert. Bitte den Dialog geöffnet lassen.</small></div>}
      <div className="modal-actions"><button className="cancel-button" onClick={onClose} disabled={saving}>Abbrechen</button><button className="add-button compact" disabled={!valid || saving} onClick={async () => { setSaving(true); setSaveError(''); setProgress(12); try { const payload = items.map((item) => ({ song: {title: item.title.trim(), artist: 'Importierte PDF', key: '–', bpm: '–', duration: '–'}, file: item.file })); setProgress(35); await onImport(payload); setProgress(100) } catch (caught) { console.error(caught); setSaveError(caught?.name === 'QuotaExceededError' ? 'Der Browserspeicher reicht für diese PDFs nicht aus. Bitte kleinere Dateien oder weniger PDFs auf einmal verwenden.' : `Import fehlgeschlagen: ${caught?.message || 'Bitte versuche es erneut.'}`); setSaving(false); setProgress(0) } }}><Upload size={18}/>{saving ? `Speichere ${items.length} PDFs…` : `${items.length || ''} ${items.length === 1 ? 'Song' : 'Songs'} importieren`}</button></div>
    </section>
  </div>
}

export default App

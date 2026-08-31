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
import { useI18n, tStatic } from './i18n'
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
        <Route path="/songs" element={<SongsPage songs={songs} openImport={openImport} onTranspose={(song)=>navigate(`/songs/${song.id}/editor`)} onEdit={setEditingSong} onDelete={async (song) => { if (!window.confirm(t('songs.confirmDelete', { title: song.title }))) return; await deleteSong(song.id); setSongs((current) => current.filter((item) => item.id !== song.id)); setSets((current) => current.map((set) => ({...set, songIds: set.songIds.filter((id) => id !== song.id)}))) }}/>}/>
        <Route path="/songs/:songId/editor" element={<SongEditorRoute songs={songs} setSongs={setSongs} navigate={navigate}/>}/>
        <Route path="/bands" element={<BandsPage bands={bands} onRefresh={setBands}/>}/>
        <Route path="/sets" element={<SetsPage sets={sets} onCreate={() => setCreateSetOpen(true)} navigate={navigate}/>}/>
        <Route path="/sets/:setId" element={<SetDetailPage sets={sets} songs={songs} team={team} updateSets={setSets} navigate={navigate}/>}/>
        <Route path="/team" element={<TeamPage team={team} onAdd={() => setTeamDialogOpen(true)} onDelete={async (member) => { if(!window.confirm(t('team.confirmRemove', { name: member.name })))return;await deleteMember(member.id);setTeam((current)=>current.filter((item)=>item.id!==member.id)) }}/>}/>
        <Route path="/termine" element={<AppointmentsPage sets={sets} appointments={appointments} onAdd={(setId='') => setAppointmentSetId(setId||sets[0]?.id||'')} onDelete={async (item)=>{if(!window.confirm(t('appointments.confirmDelete', { title: item.title })))return;await deleteAppointment(item.id);setAppointments((current)=>current.filter((entry)=>entry.id!==item.id))}} navigate={navigate}/>}/>
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
  return <footer className="app-footer"><section className="donation-card"><span className="donation-heart"><Heart size={23}/></span><div><strong>{t('footer.supportTitle')}</strong><p>{t('footer.supportText')}</p></div><a href={donationUrl} target="_blank" rel="noreferrer"><Heart size={17}/>{t('footer.paypal')}</a></section><div className="footer-main"><div><strong>{t('brand.songbook')}</strong><span>{t('footer.openSource')}</span></div><nav aria-label={t('footer.ariaWebsites')}><a href={URL_LYRUMA_STUDIO} target="_blank" rel="noreferrer">Lyruma Studio</a><a href="https://lyruma.app" target="_blank" rel="noreferrer">Lyruma App</a><a href={URL_EDUARD_WIEBE} target="_blank" rel="noreferrer">Eduard Wiebe</a></nav></div><div className="footer-bottom"><nav aria-label={t('footer.ariaLegal')}><a href="/nutzungsbedingungen.html" target="_blank" rel="noreferrer">{t('footer.terms')}</a><a href="/datenschutz.html" target="_blank" rel="noreferrer">{t('footer.privacy')}</a><a href="/impressum.html" target="_blank" rel="noreferrer">{t('footer.imprint')}</a></nav><div className="social-links" aria-label={t('footer.ariaSocial')}>{social.map(([name,url,glyph])=><a key={name} href={url} target="_blank" rel="noreferrer" title={name} aria-label={name}><span aria-hidden="true">{glyph}</span></a>)}<a href="https://www.tiktok.com/@lyrumastudio" target="_blank" rel="noreferrer" title="TikTok" aria-label="TikTok" className="tiktok-icon"><span aria-hidden="true">♪</span></a></div></div><p>{t('footer.rights', { year: new Date().getFullYear() })}</p></footer>
}

function Header({title, subtitle}) {
  const { t } = useI18n()
  return <header className="topbar app-header page-header">
    <div className="header-brand">
      <span className="header-songbook-mark" aria-hidden="true"><Music2 size={22}/></span>
      <div>
        <p className="eyebrow header-brand-eyebrow">{t('header.eyebrow')}</p>
        <h1>{title}</h1>
        {subtitle&&<p className="subtitle">{subtitle}</p>}
      </div>
    </div>
  </header>
}

function HomePage({songs, setSongs, sets, openImport, openSetDialog, navigate}) {
  const { t } = useI18n()
  const [query,setQuery]=useState('');const [activeSlide,setActiveSlide]=useState(0);const [playing,setPlaying]=useState(false);const [selectedSongId,setSelectedSongId]=useState('');const shown=songs.filter((song)=>`${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase())).slice(0,12);const selectedSong=songs.find((song)=>song.id===selectedSongId)
  const inspirationSlides=[{kind:'intro',title:t('home.introTitle'),artist:t('home.introArtist'),image:'/worship-neutral.svg'},{kind:'video',title:'Nichts unmöglich',artist:'ICF Karlsruhe Music',videoId:'neZnq_5bXkA'},{kind:'video',title:'Generation',artist:'X Worship',videoId:'ir3ZRcUsdW0'}];const safeSlide=activeSlide<inspirationSlides.length?activeSlide:0;const slide=inspirationSlides[safeSlide];const slideImage=slide.videoId?`https://i.ytimg.com/vi/${slide.videoId}/hqdefault.jpg`:slide.image
  return <><Header title={t('home.title')} subtitle={t('home.subtitle')}/>
    <label className="home-search"><Search size={24}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={t('home.searchPlaceholder')} autoComplete="off"/>{query&&<button onClick={()=>setQuery('')} aria-label={t('home.clearSearch')}><X size={18}/></button>}</label>
    <section className={`home-hero inspiration-hero${playing?' is-playing':''}`} aria-label={t('home.inspirationAria')}><img className="hero-background" src={slideImage} alt=""/><div className="hero-shade"/>{playing&&slide.videoId?<div className="hero-player"><iframe src={`https://www.youtube-nocookie.com/embed/${slide.videoId}?autoplay=1&rel=0`} title={t('home.youtubeTitle', { title: slide.title })} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/><button onClick={()=>setPlaying(false)} aria-label={t('home.closeVideo')}><X size={20}/>{t('common.close')}</button></div>:<><button className="hero-arrow hero-arrow-left" onClick={()=>{setPlaying(false);setActiveSlide((safeSlide-1+inspirationSlides.length)%inspirationSlides.length)}} aria-label={t('home.prev')}><ChevronLeft size={25}/></button><div className={`hero-content${slide.kind==='intro'?' intro-slide':''}`}>{slide.kind==='video'&&<img className="hero-poster" src={slideImage} alt={t('home.coverAlt', { title: slide.title })}/>}<div className="hero-copy"><p className="hero-label">{slide.kind==='intro'?t('brand.songbook'):t('home.newWorship')}</p><h2>{slide.title}</h2><p className="hero-date">{slide.artist}</p>{slide.kind==='intro'?<div className="intro-features"><span>{t('home.featureLyrics')}</span><span>{t('home.featureChords')}</span><span>{t('home.featureSets')}</span><span>{t('home.featurePlay')}</span></div>:<button className="hero-set-link" onClick={()=>setPlaying(true)}><Play size={17}/>{t('home.toSong')}</button>}</div></div><button className="hero-arrow hero-arrow-right" onClick={()=>{setPlaying(false);setActiveSlide((safeSlide+1)%inspirationSlides.length)}} aria-label={t('home.next')}><ChevronRight size={25}/></button></>}<div className="hero-dots">{inspirationSlides.map((item,index)=><button key={item.title} className={index===safeSlide?'active':''} onClick={()=>{setPlaying(false);setActiveSlide(index)}} aria-label={t('home.slideN', { n: index+1 })}/>)}</div></section>
    {selectedSong?<TransposeDialog embedded homeEmbedded song={selectedSong} onClose={()=>setSelectedSongId('')} onSave={async(values)=>{const variant=await saveSongVariant(selectedSong.id,values);setSongs((current)=>current.map((item)=>item.id===selectedSong.id?{...item,key:variant.targetKey,sourceKey:variant.sourceKey,preferredKey:variant.targetKey,variantKeys:Array.from(new Set([variant.targetKey,...(item.variantKeys||[])]))}:item));return variant}}/>:<><section className="home-section"><div className="home-section-head"><div><p className="eyebrow">{t('home.library')}</p><h2>{query?t('home.searchResults', { query }):t('home.openSongs')}</h2></div><button className="text-button" onClick={openImport}><Plus size={17}/>{t('home.addSong')}</button></div>{shown.length?<div className="song-tile-row">{shown.map((song,index)=><button className="song-tile" key={song.id} onClick={()=>setSelectedSongId(song.id)}><span className={`song-cover cover-tone-${index%6}`}><Music2 size={31}/><span>{song.title}</span><i><Play size={17}/></i></span><span className="song-tile-copy"><span className="song-rank">{index+1}</span>{(song.preferredKey||song.key)&&<span className="song-key">{t('home.key', { key: song.preferredKey||song.key })}</span>}<strong>{song.title}</strong><small>{song.artist||t('brand.songbook')}</small><span className="tile-open">{t('home.openInEditor')} <ChevronRight size={15}/></span></span></button>)}{!query&&songs.length>12&&<button className="song-tile more-tile" onClick={()=>navigate('/songs')}><span className="more-cover"><Plus size={30}/></span><span className="song-tile-copy"><span className="song-rank">12+</span><strong>{t('home.allSongs')}</strong><small>{t('home.fullLibrary')}</small><span className="tile-open">{t('home.toLibrary')} <ChevronRight size={15}/></span></span></button>}</div>:<div className="empty-state small"><Search size={30}/><h3>{t('home.noSongTitle')}</h3><p>{t('home.noSongText')}</p></div>}</section>
    <section className="home-section"><div className="home-section-head"><div><p className="eyebrow">{t('home.planning')}</p><h2>{t('home.setsEvents')}</h2></div><button className="text-button" onClick={openSetDialog}><Plus size={17}/>{t('home.newSet')}</button></div><div className="set-poster-row">{sets.map((set,index)=><button className="set-poster-card" key={set.id} onClick={()=>navigate(`/sets/${set.id}`)}><div className="set-poster-image">{(set.theme||set.title).toLowerCase().includes('fundament')?<img src="/worship-neutral.svg" alt=""/>:<span className={`poster-placeholder cover-tone-${index%6}`}><ListMusic size={32}/></span>}<span>{formatDate(set.date)}</span></div><strong>{set.theme||set.title}</strong><small>{set.venue||t('common.nSongs', { count: set.songIds.length })}</small></button>)}{!sets.length&&<p className="empty">{t('home.noSetYet')}</p>}</div></section>
    <section className="quick-actions home-quick"><button className="primary-action" onClick={openImport}><Upload size={21}/><span><strong>{t('home.importPdfs')}</strong><small>{t('home.importPdfsHint')}</small></span></button><button className="secondary-action" onClick={openSetDialog}><ListMusic size={21}/><span><strong>{t('home.planSet')}</strong><small>{t('home.planSetHint')}</small></span></button></section></>}
  </>
}

function SongsPage({songs, openImport, onTranspose, onEdit, onDelete}) {
  const { t } = useI18n()
  return <><Header title={t('pages.songs')} subtitle={t('pages.songsSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={openImport}><Plus size={18}/>{t('songs.add')}</button></div><SongPanel songs={songs} onTranspose={onTranspose} onEdit={onEdit} onDelete={onDelete}/></>
}

function SongPanel({songs, onAll, onTranspose, onEdit, onDelete}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const shown = songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="panel"><div className="panel-header"><div><p className="eyebrow">{t('songs.library')}</p><h2>{onAll ? t('songs.recent') : t('songs.count', { count: songs.length })}</h2></div><div className="search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('songs.searchPlaceholder')}/></div></div>
    <div className="song-list">{shown.map((song, index) => <SongRow key={song.id || `${song.title}-${index}`} song={song} index={index} onTranspose={onTranspose} onEdit={onEdit} onDelete={onDelete}/>)}</div>
    {shown.length === 0 && <p className="empty">{t('songs.noneFound')}</p>}{onAll && <button className="text-button" onClick={onAll}>{t('songs.showAll')}</button>}
  </section>
}

function SongRow({song, index, onTranspose, onEdit, onDelete}) {
  const { t } = useI18n()
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
    {onDelete && !song.isProtected && <button className="swipe-delete" onClick={() => onDelete(song)} aria-label={t('songs.deleteAria', { title: song.title })}><Trash2 size={22}/><span>{t('songs.delete')}</span></button>}
    <article className="song-row" onTouchStart={(event) => { touchStart.current = event.touches[0].clientX }} onTouchEnd={(event) => finishSwipe(event.changedTouches[0].clientX)}>
      <div className="song-number">{String(index + 1).padStart(2, '0')}</div><div className="song-icon"><FileMusic size={21}/></div><div className="song-main"><strong>{song.title}</strong><span>{song.artist}{song.fileName ? ` · ${(song.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}{song.preferredKey?` · ${t('songs.versionKey', { key: song.preferredKey })}`:''}{song.isProtected?` · ${t('songs.protected')}`:''}</span></div><div className="song-meta"><span><b>{song.key || '–'}</b> {t('songs.key')}</span><span><b>{song.bpm || '–'}</b> {t('songs.bpm')}</span><span><Clock3 size={14}/>{song.duration || '–'}</span></div>{hasSongPdf(song) && <button className="icon-button" title={t('songs.openPdf')} onClick={() => openSongPdf(song)}><Eye size={18}/></button>}{onTranspose&&<button className="transpose-button" title={t('songs.transpose')} onClick={()=>onTranspose(song)}><Music2 size={17}/></button>}{onEdit ? <button className="icon-button" title={t('songs.edit')} onClick={() => onEdit(song)}><Pencil size={17}/></button> : <button className="icon-button"><MoreHorizontal size={18}/></button>}{onDelete && !song.isProtected && <button className="desktop-delete" title={t('songs.deleteSongPdf')} onClick={() => onDelete(song)}><Trash2 size={18}/></button>}
    </article>
  </div>
}

function SimplePage({eyebrow, title, text}) {
  const { t } = useI18n()
  return <><Header title={title} subtitle={text}/><section className="panel placeholder"><p className="eyebrow">{eyebrow}</p><h2>{t('simple.comingSoon', { title })}</h2><p>{t('simple.comingSoonBody')}</p></section></>
}

function BandsPage({bands}) {
  const { t } = useI18n()
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
      if(!rows.length)setJoinInfo(t('bands.noneFound'))
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
      setJoinInfo(t('bands.requestSent', { name: result.bandName }))
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
    if(!window.confirm(t('bands.confirmDelete', { name: band.name })))return

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
    <Header title={t('pages.bands')} subtitle={t('pages.bandsSubtitle')}/>

    <div className="page-actions">
      <button className="add-button compact" onClick={openCreate}>
        <Plus size={18}/>{t('bands.create')}
      </button>
    </div>

    <section className="band-current">
      <div>
        <p className="eyebrow">{t('bands.activeWorkspace')}</p>
        <h2>{active?.name||t('nav.personalSongbook')}</h2>
        <p>{active?.description||t('bands.personalOnly')}</p>
      </div>

      {active&&
        <button className="personal-button" onClick={personal} disabled={busy==='personal'}>
          {busy==='personal'?t('bands.switching'):t('bands.toPersonal')}
        </button>
      }
    </section>

    {error&&<p className="auth-error">{error}</p>}

    {editor&&
      <section className="panel band-editor">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{t('bands.manage')}</p>
            <h2>{editor.mode==='create'?t('bands.createNew'):t('bands.edit')}</h2>
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
              ? <img src={logoPreview} alt={t('bands.logoPreviewAlt')}/>
              : <>
                  <Users size={25}/>
                  <strong>{t('bands.logo')}</strong>
                  <span>{t('bands.logoFormats')}</span>
                </>
            }
          </label>

          <div>
            <strong>{t('bands.logoOf')}</strong>
            <p>{t('bands.logoHint')}</p>

            {editor.mode==='edit'&&editor.hasLogo&&
              <button
                className="profile-photo-remove"
                disabled={busy==='logo-delete'}
                onClick={removeLogo}
              >
                <Trash2 size={16}/>
                {t('bands.removeLogo')}
              </button>
            }
          </div>
        </div>

        <div className="band-editor-fields">
          <label className="field">
            <span>{t('bands.name')}</span>
            <div>
              <Users size={18}/>
              <input
                value={name}
                maxLength={80}
                onChange={e=>setName(e.target.value)}
                placeholder={t('bands.namePlaceholder')}
                autoFocus
              />
            </div>
          </label>

          <label className="field">
            <span>{t('bands.description')}</span>
            <textarea
              value={description}
              maxLength={300}
              onChange={e=>setDescription(e.target.value)}
              placeholder={t('bands.descriptionPlaceholder')}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="cancel-button" onClick={closeEditor}>
            {t('common.cancel')}
          </button>

          <button
            className="add-button compact"
            disabled={name.trim().length<2||busy==='save'}
            onClick={saveBand}
          >
            <CheckCircle2 size={18}/>
            {busy==='save'
              ? t('common.saving')
              : editor.mode==='create'
                ? t('bands.create')
                : t('songs.saveChanges')}
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
                <span>{band.active?t('bands.active'):t('bands.own')}</span>
                <h3>{band.name}</h3>
                <p>{band.description||t('bands.noDescription')}</p>
              </div>

              <div className="band-card-actions">
                <button
                  className="band-select-button"
                  disabled={band.active||busy===band.id}
                  onClick={()=>activate(band)}
                >
                  {busy===band.id?t('common.pleaseWait'):band.active?t('common.selected'):t('bands.select')}
                </button>

                {band.canEdit&&
                  <button className="band-edit-button" onClick={()=>openEdit(band)}>
                    <Pencil size={17}/>{t('common.edit')}
                  </button>
                }

                {band.canEdit&&
                  <button
                    className="band-delete-button"
                    disabled={busy===`delete-${band.id}`}
                    onClick={()=>removeBand(band)}
                  >
                    <Trash2 size={17}/>
                    {busy===`delete-${band.id}`?t('common.deleting'):t('common.delete')}
                  </button>
                }
              </div>
            </article>
          )}
        </section>
      : <section className="panel">
          <div className="empty-state">
            <Users size={40}/>
            <h3>{t('bands.emptyTitle')}</h3>
            <p>{t('bands.emptyText')}</p>
            <button className="add-button compact" onClick={openCreate}>
              <Plus size={18}/>{t('bands.first')}
            </button>
          </div>
        </section>
    }

    {active?.canEdit&&
      <section className="panel band-access-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{t('bands.access')}</p>
            <h2>{t('bands.accessHint')}</h2>
          </div>

          <button className="add-button compact" onClick={createInvite} disabled={busy==='invite'}>
            <Plus size={17}/>{busy==='invite'?t('bands.creating'):t('bands.createInvite')}
          </button>
        </div>

        <div className="band-access-grid">
          <div>
            <h3>{t('bands.openRequests')}</h3>
            {joinRequests.length
              ? <div className="join-request-list">
                  {joinRequests.map(request=><article key={request.id}>
                    <div>
                      <strong>{request.userName}</strong>
                      <span>@{request.username}</span>
                    </div>
                    <button onClick={()=>decideJoinRequest(request.id,'reject')} disabled={busy===`join-${request.id}`}>{t('bands.reject')}</button>
                    <button className="approve" onClick={()=>decideJoinRequest(request.id,'approve')} disabled={busy===`join-${request.id}`}>{t('bands.approve')}</button>
                  </article>)}
                </div>
              : <p className="band-access-empty">{t('bands.noRequests')}</p>
            }
          </div>

          <div>
            <h3>{t('bands.activeCodes')}</h3>
            {invites.filter(invite=>invite.active).length
              ? <div className="invite-list">
                  {invites.filter(invite=>invite.active).map(invite=><article key={invite.id}>
                    <code>{invite.code}</code>
                    <span>{t('bands.codeUsage', { used: invite.useCount, max: invite.maxUses, date: new Date(invite.expiresAt).toLocaleDateString() })}</span>
                  </article>)}
                </div>
              : <p className="band-access-empty">{t('bands.noCode')}</p>
            }
          </div>
        </div>
      </section>
    }

    {active&&
      <section className="panel band-members">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{t('bands.together')}</p>
            <h2>{t('bands.membersOf', { name: active.name })}</h2>
          </div>
        </div>

        <div className="member-chips">
          {members.accounts.map(member=>
            <span key={`a-${member.id}`}>
              <b>{initials(member.name)}</b>
              <span>
                <strong>{member.name}</strong>
                <small>{member.role==='owner'?t('bands.manageRole'):t('bands.member')}</small>
              </span>
            </span>
          )}
        </div>
      </section>
    }

    <section className="panel band-access-panel band-join-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t('bands.join')}</p>
          <h2>{t('bands.joinExisting')}</h2>
        </div>
      </div>

      <div className="band-access-grid">
        <div>
          <h3>{t('bands.search')}</h3>
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
              placeholder={t('bands.searchPlaceholder')}
            />
            <button
              type="button"
              className="add-button compact"
              onClick={runBandSearch}
              disabled={busy==='search'||bandSearch.trim().length<3}
            >
              <Search size={17}/>{busy==='search'?t('common.searching'):t('common.search')}
            </button>
          </div>

          {bandResults.length>0&&
            <div className="join-request-list band-join-results">
              {bandResults.map(band=>
                <article key={band.id}>
                  <div>
                    <strong>{band.name}</strong>
                    <span>{band.description||t('bands.noDescriptionShort')}</span>
                  </div>
                  <button
                    type="button"
                    className="approve"
                    disabled={busy===`request-${band.id}`||bands.some(item=>item.id===band.id)}
                    onClick={()=>sendJoinRequest(band)}
                  >
                    {bands.some(item=>item.id===band.id)
                      ? t('bands.alreadyMember')
                      : busy===`request-${band.id}`?t('bands.sending'):t('bands.sendRequest')}
                  </button>
                </article>
              )}
            </div>
          }
        </div>

        <div>
          <h3>{t('bands.inviteCode')}</h3>
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
              {busy==='code'?t('bands.joining'):t('bands.join')}
            </button>
          </div>
        </div>
      </div>

      {myRequests.length>0&&
        <div className="band-my-requests">
          <h3>{t('bands.myRequests')}</h3>
          <div className="invite-list">
            {myRequests.map(request=>
              <article key={request.id}>
                <strong>{request.bandName}</strong>
                <span>{t('bands.waiting')}</span>
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
  if (!date) return tStatic('common.noDate')
  let locale = 'de'
  try { const stored = localStorage.getItem('songbook-locale'); if (stored === 'en' || stored === 'de') locale = stored } catch {}
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'de-DE', {day: '2-digit', month: '2-digit', year: 'numeric'}).format(new Date(`${date}T12:00:00`))
}

function formatCompactDate(date) {
  if(!date)return tStatic('common.dateOpen')
  let locale = 'de'
  try { const stored = localStorage.getItem('songbook-locale'); if (stored === 'en' || stored === 'de') locale = stored } catch {}
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale === 'en' ? 'en-US' : 'de-DE',{day:'2-digit',month:'short'})
}

function initials(name) { const parts=name.trim().split(/\s+/).filter(Boolean);return parts.length>1?`${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase():(parts[0]?.slice(0,2).toUpperCase()||'') }

function TeamPage({team, onAdd, onDelete}) {
  const { t } = useI18n()
  return <><Header title={t('pages.team')} subtitle={t('pages.teamSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={onAdd}><Plus size={18}/>{t('team.add')}</button></div><section className="panel"><div className="panel-header"><div><p className="eyebrow">{t('team.band')}</p><h2>{team.length===1?t('team.count', { count: team.length }):t('team.countPlural', { count: team.length })}</h2></div></div>{team.length?<div className="team-grid">{team.map((member)=><article className="member-card" key={member.id}><div className="member-avatar">{member.hasPhoto?<AuthorizedImg path={memberPhoto(member)} alt=""/>:<span>{member.initials||initials(member.name)}</span>}</div><div className="member-info"><h3>{member.name} <small>{member.initials||initials(member.name)}</small></h3><p>{member.roles.join(' · ')||t('team.noRole')}</p><div>{member.isLeader&&<span>{t('team.leader')}</span>}{member.isOrganizer&&<span>{t('team.organizer')}</span>}{member.isDesigner&&<span>{t('team.designer')}</span>}{member.isTechnician&&<span>{t('team.technician')}</span>}</div></div><button className="desktop-delete" onClick={()=>onDelete(member)} title={t('team.removeTitle')}><Trash2 size={18}/></button></article>)}</div>:<div className="empty-state"><Users size={38}/><h3>{t('team.emptyTitle')}</h3><p>{t('team.emptyText')}</p><button className="add-button compact" onClick={onAdd}><Plus size={18}/>{t('team.first')}</button></div>}</section></>
}

const roleOptionKeys=['vocals','acoustic','electric','bass','keys','drums','percussion','brass','strings','sound','lights','songLead','org','other']
function TeamDialog({onClose,onSave}) {
  const { t } = useI18n()
  const roleOptions = roleOptionKeys.map((key) => t(`team.role.${key}`))
  const [name,setName]=useState('');const [roles,setRoles]=useState([]);const [isLeader,setIsLeader]=useState(false);const [isOrganizer,setIsOrganizer]=useState(false);const [isDesigner,setIsDesigner]=useState(false);const [isTechnician,setIsTechnician]=useState(false);const [photo,setPhoto]=useState(null);const [preview,setPreview]=useState('');const [saving,setSaving]=useState(false)
  const toggle=(role)=>setRoles((current)=>current.includes(role)?current.filter((item)=>item!==role):[...current,role])
  return <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><section className="modal modal-wide"><div className="modal-header"><div><p className="eyebrow">{t('nav.team')}</p><h2>{t('team.add')}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><div className="member-form-head"><label className="photo-picker"><input type="file" accept="image/*" onChange={(event)=>{const file=event.target.files?.[0];if(file){setPhoto(file);setPreview(URL.createObjectURL(file))}}}/>{preview?<img src={preview} alt={t('team.previewAlt')}/>:<><b>{name.trim()?initials(name):'+'}</b><span>{t('team.photo')}</span></>}</label><label className="field grow"><span>{t('team.name')}</span><div><Users size={18}/><input value={name} onChange={(event)=>setName(event.target.value)} placeholder={t('team.namePlaceholder')} autoFocus/></div><small>{t('team.initials')} <strong>{name.trim()?initials(name):'–'}</strong></small></label></div><div className="role-field"><span>{t('team.roles')}</span><div className="role-options">{roleOptions.map((role)=><button type="button" className={roles.includes(role)?'selected':''} onClick={()=>toggle(role)} key={role}>{role}</button>)}</div></div><div className="responsibility-options"><label><input type="checkbox" checked={isLeader} onChange={(event)=>setIsLeader(event.target.checked)}/><span><strong>{t('team.leader')}</strong><small>{t('team.leaderHint')}</small></span></label><label><input type="checkbox" checked={isOrganizer} onChange={(event)=>setIsOrganizer(event.target.checked)}/><span><strong>{t('team.organizer')}</strong><small>{t('team.organizerHint')}</small></span></label><label><input type="checkbox" checked={isDesigner} onChange={(event)=>setIsDesigner(event.target.checked)}/><span><strong>{t('team.designer')}</strong><small>{t('team.designerHint')}</small></span></label><label><input type="checkbox" checked={isTechnician} onChange={(event)=>setIsTechnician(event.target.checked)}/><span><strong>{t('team.technician')}</strong><small>{t('team.technicianHint')}</small></span></label></div><div className="modal-actions"><button className="cancel-button" onClick={onClose}>{t('common.cancel')}</button><button className="add-button compact" disabled={!name.trim()||saving} onClick={async()=>{setSaving(true);try{await onSave({name:name.trim(),roles,isLeader,isOrganizer,isDesigner,isTechnician,photo})}finally{setSaving(false)}}}><Plus size={18}/>{saving?t('common.saving'):t('common.add')}</button></div></section></div>
}

const appointmentTypeKeys=['rehearsal','planning','soundcheck','other']
function AppointmentsPage({sets,appointments,onAdd,onDelete,navigate}) {
  const { t, locale } = useI18n()
  const sortedSets=[...sets].sort((a,b)=>a.date.localeCompare(b.date))
  return <><Header title={t('pages.appointments')} subtitle={t('pages.appointmentsSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={()=>onAdd()} disabled={!sets.length}><Plus size={18}/>{t('appointments.create')}</button></div>{sortedSets.length?sortedSets.map((set)=>{const rehearsals=appointments.filter((item)=>item.setId===set.id).sort((a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));const place=[set.band,set.venue].filter(Boolean).join(' in ')||t('appointments.placeOpen');return <section className="panel concert-block" key={set.id}><div className="concert-head"><div className="concert-date"><strong>{formatCompactDate(set.date)}</strong><span>{set.eventTime?t('common.timeSuffix', { time: set.eventTime }):t('appointments.startOpen')}</span></div><div className="concert-dot"/><div className="concert-copy"><span>{t('appointments.concert')}</span><h2>{set.theme||set.title}</h2><p>{place}</p><button className="text-button" onClick={()=>navigate(`/sets/${set.id}`)}>{t('appointments.openSet')}</button></div></div><div className="rehearsal-section"><div className="rehearsal-head"><div><p className="eyebrow">{t('appointments.prep')}</p><h3>{t('appointments.rehearsals')}</h3></div><button className="add-button compact" onClick={()=>onAdd(set.id)}><Plus size={17}/>{t('appointments.addRehearsal')}</button></div>{rehearsals.length?<div className="rehearsal-list">{rehearsals.map((item)=><article key={item.id}><div className="rehearsal-date"><strong>{new Date(`${item.date}T12:00:00`).toLocaleDateString(locale==='en'?'en-US':'de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})}</strong><span>{item.time?t('common.timeSuffix', { time: item.time }):t('appointments.timeOpen')}</span></div><div><b>{item.title}</b><p>{item.location||place}{item.notes&&` · ${item.notes}`}</p></div><button className="desktop-delete" onClick={()=>onDelete(item)} title={t('appointments.deleteTitle')}><Trash2 size={17}/></button></article>)}</div>:<div className="no-rehearsals"><CalendarDays size={24}/><div><strong>{t('appointments.noRehearsalTitle')}</strong><span>{t('appointments.noRehearsalText')}</span></div></div>}</div></section>}):<section className="panel"><div className="empty-state"><CalendarDays size={38}/><h3>{t('appointments.noSetsTitle')}</h3><p>{t('appointments.noSetsText')}</p></div></section>}</>
}

function AppointmentDialog({sets,initialSetId,onClose,onSave}) {
  const { t } = useI18n()
  const appointmentTypes = Object.fromEntries(appointmentTypeKeys.map((key) => [key, t(`appointments.types.${key}`)]))
  const initialSet=sets.find((set)=>set.id===initialSetId);const [setId,setSetId]=useState(initialSetId||sets[0]?.id||'');const [type,setType]=useState('rehearsal');const [title,setTitle]=useState(appointmentTypes.rehearsal);const [date,setDate]=useState('');const [time,setTime]=useState('19:30');const [location,setLocation]=useState([initialSet?.band,initialSet?.venue].filter(Boolean).join(' in '));const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false)
  return <div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><section className="modal"><div className="modal-header"><div><p className="eyebrow">{t('appointments.dialogEyebrow')}</p><h2>{t('appointments.dialogTitle')}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><label className="field"><span>{t('appointments.relatedSet')}</span><div><ListMusic size={18}/><select value={setId} onChange={(event)=>setSetId(event.target.value)}>{sets.map((set)=><option value={set.id} key={set.id}>{set.title} · {formatDate(set.date)}</option>)}</select></div></label><label className="field"><span>{t('appointments.typeLabel')}</span><div><CalendarDays size={18}/><select value={type} onChange={(event)=>{setType(event.target.value);setTitle(appointmentTypes[event.target.value])}}>{appointmentTypeKeys.map((value)=><option value={value} key={value}>{appointmentTypes[value]}</option>)}</select></div></label><label className="field"><span>{t('appointments.title')}</span><div><FileText size={18}/><input value={title} onChange={(event)=>setTitle(event.target.value)}/></div></label><div className="dialog-columns"><label className="field"><span>{t('appointments.date')}</span><div><CalendarDays size={18}/><input type="date" value={date} onChange={(event)=>setDate(event.target.value)}/></div></label><label className="field"><span>{t('appointments.time')}</span><div><Clock3 size={18}/><input type="time" value={time} onChange={(event)=>setTime(event.target.value)}/></div></label></div><label className="field"><span>{t('appointments.location')}</span><div><Home size={18}/><input value={location} onChange={(event)=>setLocation(event.target.value)} placeholder={t('appointments.locationPlaceholder')}/></div></label><label className="field"><span>{t('appointments.notes')}</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder={t('appointments.notesPlaceholder')}/></label><div className="modal-actions"><button className="cancel-button" onClick={onClose}>{t('common.cancel')}</button><button className="add-button compact" disabled={!setId||!title.trim()||!date||saving} onClick={async()=>{setSaving(true);try{await onSave({setId,type,title:title.trim(),date,time,location,notes})}finally{setSaving(false)}}}><Plus size={18}/>{saving?t('common.saving'):t('appointments.save')}</button></div></section></div>
}

function SetsPage({sets, onCreate, navigate}) {
  const { t } = useI18n()
  return <><Header title={t('pages.sets')} subtitle={t('pages.setsSubtitle')}/><div className="page-actions"><button className="add-button compact" onClick={onCreate}><Plus size={18}/>{t('sets.newPlan')}</button></div>
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">{t('sets.planning')}</p><h2>{sets.length} {t('pages.sets')}</h2></div></div>
      {sets.length ? <div className="set-library">{sets.map((set) => <button className="set-library-card" key={set.id} onClick={() => navigate(`/sets/${set.id}`)}><div className="set-date">{formatDate(set.date)}</div><h3>{set.title}</h3><p>{t('common.nSongs', { count: set.songIds.length })}</p><span>{t('sets.planArrowShort')} <ChevronRight size={17}/></span></button>)}</div> : <div className="empty-state"><ListMusic size={36}/><h3>{t('sets.emptyTitle')}</h3><p>{t('sets.emptyText')}</p><button className="add-button compact" onClick={onCreate}><Plus size={18}/>{t('sets.create')}</button></div>}
    </section></>
}

function CreateSetDialog({onClose, onCreate}) {
  const { t } = useI18n()
  const [title, setTitle] = useState(t('sets.defaultTitle'))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [eventTime, setEventTime] = useState('')
  const [arrivalTime, setArrivalTime] = useState('')
  const [band, setBand] = useState('')
  const [theme, setTheme] = useState('')
  const [venue, setVenue] = useState('')
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{t('sets.planning')}</p><h2>{t('sets.new')}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <label className="field"><span>{t('sets.name')}</span><div><ListMusic size={18}/><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus/></div></label>
    <label className="field"><span>{t('sets.bandProject')}</span><div><Users size={18}/><input value={band} onChange={(e)=>setBand(e.target.value)} placeholder={t('sets.bandPlaceholder')}/></div></label>
    <label className="field"><span>{t('sets.theme')}</span><div><FileText size={18}/><input value={theme} onChange={(e)=>setTheme(e.target.value)} placeholder={t('sets.themePlaceholder')}/></div></label>
    <label className="field"><span>{t('sets.venue')}</span><div><Home size={18}/><input value={venue} onChange={(e)=>setVenue(e.target.value)} placeholder={t('sets.venuePlaceholder')}/></div></label>
    <label className="field"><span>{t('sets.date')}</span><div><CalendarDays size={18}/><input type="date" value={date} onChange={(e) => setDate(e.target.value)}/></div></label>
    <label className="field"><span>{t('sets.startTime')}</span><div><Clock3 size={18}/><input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)}/></div></label>
    <label className="field"><span>{t('sets.meetFrom')}</span><div><Clock3 size={18}/><input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)}/></div></label>
    <div className="modal-actions"><button className="cancel-button" onClick={onClose}>{t('common.cancel')}</button><button className="add-button compact" disabled={!title.trim()} onClick={() => onCreate({title: title.trim(), date, eventTime, arrivalTime, band, theme, venue})}><Plus size={18}/>{t('sets.create')}</button></div>
  </section></div>
}

function SetDetailPage({sets, songs, team, updateSets, navigate}) {
  const { t } = useI18n()
  const {setId} = useParams()
  const set = sets.find((item) => item.id === setId)
  const [running, setRunning] = useState(false)
  if (!set) return <SimplePage eyebrow={t('sets.planning')} title={t('sets.notFound')} text={t('sets.notFoundText')}/>
  const setSongs = set.songIds.map((id) => songs.find((song) => song.id === id)).filter(Boolean)
  const available = songs.filter((song) => !set.songIds.includes(song.id))
  const update = (changes) => { const next={...set,...changes}; updateSets((current) => current.map((item) => item.id === set.id ? next : item)); saveSet(next).catch(console.error) }
  const addSong = (id) => { const song=songs.find((item)=>item.id===id);update({songIds: [...set.songIds, id],songKeys:{...(set.songKeys||{}),...(song?.preferredKey?{[id]:song.preferredKey}:{})}}) }
  const removeSong = (index) => { const songId=set.songIds[index];const songKeys={...(set.songKeys||{})};delete songKeys[songId];const leaders={...(set.leaders||{})};delete leaders[songId];update({songIds: set.songIds.filter((_, itemIndex) => itemIndex !== index),songKeys,leaders}) }
  const moveSong = (index, offset) => { const next = [...set.songIds]; const target = index + offset; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; update({songIds: next}) }
  const assignLeader = (songId, memberId) => update({leaders: {...(set.leaders || {}), [songId]: memberId}})
  const assignSongKey = (songId, key) => update({songKeys: {...(set.songKeys || {}), [songId]: key}})
  const soundRole = t('team.role.sound')
  return <><button className="back-button" onClick={() => navigate('/sets')}><ChevronLeft size={18}/>{t('sets.allSets')}</button><Header title={set.title} subtitle={`${formatDate(set.date)} · ${t('common.nSongs', { count: setSongs.length })}`}/>
    <div className="set-toolbar"><button className="run-button" disabled={!setSongs.length} onClick={() => setRunning(true)}><Play size={19}/>{t('sets.start')}</button><span>{t('sets.autoSave')}</span>{!set.isProtected&&<button className="delete-set-button" onClick={async () => { if (!window.confirm(t('sets.confirmDelete', { title: set.title }))) return; await deleteSet(set.id); updateSets((current) => current.filter((item) => item.id !== set.id)); navigate('/sets') }}><Trash2 size={17}/>{t('sets.delete')}</button>}</div>
    <section className="panel event-details"><div className="panel-header"><div><p className="eyebrow">{t('sets.event')}</p><h2>{t('sets.eventMeta')}</h2></div></div><div className="briefing-grid"><label className="field"><span>{t('sets.bandProject')}</span><div><Users size={18}/><input value={set.band||''} onChange={(event)=>update({band:event.target.value})} placeholder={t('sets.bandPlaceholder')}/></div></label><label className="field"><span>{t('sets.theme')}</span><div><FileText size={18}/><input value={set.theme||''} onChange={(event)=>update({theme:event.target.value})} placeholder={t('sets.themePlaceholder')}/></div></label><label className="field"><span>{t('appointments.location')}</span><div><Home size={18}/><input value={set.venue||''} onChange={(event)=>update({venue:event.target.value})} placeholder={t('sets.venuePlaceholder')}/></div></label><label className="field"><span>{t('sets.date')}</span><div><CalendarDays size={18}/><input type="date" value={set.date||''} onChange={(event)=>update({date:event.target.value})}/></div></label><label className="field"><span>{t('sets.meetFrom')}</span><div><Clock3 size={18}/><input type="time" value={set.arrivalTime||''} onChange={(event)=>update({arrivalTime:event.target.value})}/></div></label><label className="field"><span>{t('sets.concertStart')}</span><div><Clock3 size={18}/><input type="time" value={set.eventTime||''} onChange={(event)=>update({eventTime:event.target.value})}/></div></label></div></section>
    <div className="planner-grid"><section className="panel planner-panel"><div className="panel-header"><div><p className="eyebrow">{t('sets.flow')}</p><h2>{t('sets.order')}</h2></div></div>
      {setSongs.length ? <div className="planned-songs">{setSongs.map((song, index) => { const leaderId=set.leaders?.[song.id]||'';const leader=team.find((member)=>member.id===leaderId);const selectedKey=set.songKeys?.[song.id]||'';return <div className="planned-song" key={`${song.id}-${index}`}><span className="order-number">{index + 1}</span><div className="song-main"><strong>{song.title}</strong><span>{song.artist}{selectedKey?` · ${t('home.key', { key: selectedKey })}`:hasSongPdf(song)?` · ${t('songs.originalPdf')}`:''}</span></div><div className="set-song-options"><label className="leader-select">{leader&&<b>{leader.initials||initials(leader.name)}</b>}{leaderId==='group'&&<b>ALL</b>}<select value={leaderId} onChange={(event)=>assignLeader(song.id,event.target.value)}><option value="">{t('sets.chooseLead')}</option><option value="group">{t('sets.allTogether')}</option>{team.map((member)=><option value={member.id} key={member.id}>{member.name} ({member.initials||initials(member.name)})</option>)}</select></label><label className="set-key-select"><select value={selectedKey} onChange={(event)=>assignSongKey(song.id,event.target.value)}><option value="">{t('songs.originalPdf')}</option>{(song.variantKeys||[]).map((key)=><option value={key} key={key}>{t('home.key', { key })}</option>)}</select></label></div><div className="order-actions"><button className="icon-button" disabled={index === 0} onClick={() => moveSong(index, -1)}><ArrowUp size={17}/></button><button className="icon-button" disabled={index === setSongs.length - 1} onClick={() => moveSong(index, 1)}><ArrowDown size={17}/></button>{selectedKey?<button className="icon-button" onClick={()=>openSongChart(song,selectedKey)} title={t('sets.openVersion', { key: selectedKey })}><Eye size={17}/></button>:hasSongPdf(song) && <button className="icon-button" onClick={() => openSongPdf(song)} title={t('songs.openPdf')}><Eye size={17}/></button>}<button className="icon-button danger" onClick={() => removeSong(index)}><Trash2 size={17}/></button></div></div>})}</div> : <div className="empty-state small"><Music2 size={30}/><h3>{t('sets.noSongs')}</h3><p>{t('sets.noSongsHint')}</p></div>}
    </section><section className="panel planner-panel"><div className="panel-header"><div><p className="eyebrow">{t('songs.library')}</p><h2>{t('sets.addSongs')}</h2></div></div>
      <div className="available-songs">{available.map((song) => <button key={song.id} onClick={() => addSong(song.id)}><div><strong>{song.title}</strong><span>{song.artist}{hasSongPdf(song) ? ' · PDF' : ''}</span></div><Plus size={18}/></button>)}{!available.length && <p className="empty">{t('sets.allAlready')}</p>}</div>
    </section></div><section className="panel tech-briefing"><div className="panel-header"><div><p className="eyebrow">{t('sets.tech')}</p><h2>{t('sets.techBrief')}</h2></div></div><div className="briefing-grid"><label className="field"><span>{t('sets.responsible')}</span><div><Users size={18}/><select value={set.technicianId||''} onChange={(event)=>update({technicianId:event.target.value})}><option value="">{t('sets.chooseTech')}</option>{team.filter((member)=>member.isTechnician||member.roles.includes(soundRole)||member.roles.includes('Tontechnik')).map((member)=><option value={member.id} key={member.id}>{member.name}</option>)}</select></div></label><label className="field"><span>{t('sets.dateAndStart')}</span><div><CalendarDays size={18}/><input value={`${formatDate(set.date)}${set.eventTime?` · ${t('common.timeSuffix', { time: set.eventTime })}`:''}`} readOnly/></div></label><label className="field briefing-notes"><span>{t('sets.techNotesLabel')}</span><textarea value={set.techNotes||''} onChange={(event)=>update({techNotes:event.target.value})} placeholder={t('sets.techNotesPlaceholder')}/></label></div></section>
    {running && <RunSet set={set} songs={setSongs} onClose={() => setRunning(false)}/>}</>
}

function RunSet({set, songs, onClose}) {
  const { t } = useI18n()
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
  return <div className="run-mode"><header><div><p className="eyebrow">{t('sets.runMode')}</p><strong>{set.title}</strong><span>{index + 1}/{songs.length} · {song.title}{selectedKey?` · ${t('home.key', { key: selectedKey })}`:''}</span></div><button className="icon-button" onClick={onClose}><X size={22}/></button></header>
    <main className="pdf-stage" onTouchStart={(event) => { touchStart.current = event.touches[0].clientX }} onTouchEnd={(event) => finishSwipe(event.changedTouches[0].clientX)}>
      {selectedKey ? <AuthorizedFrame key={`${song.id}-${selectedKey}`} title={`${song.title} – ${selectedKey}`} path={songChartUrl(song,selectedKey)}/> : hasSongPdf(song) ? <AuthorizedFrame key={song.id} title={song.title} path={songPdfUrl(song)} hash="#toolbar=0&navpanes=0&view=FitH"/> : <div className="no-pdf"><FileText size={42}/><strong>{song.title}</strong><span>{t('sets.noPdf')}</span></div>}
      <button className="stage-arrow left" disabled={index === 0} onClick={previous} aria-label={t('sets.prevSong')}><ChevronLeft size={32}/></button><button className="stage-arrow right" disabled={index === songs.length - 1} onClick={next} aria-label={t('sets.nextSong')}><ChevronRight size={32}/></button>
    </main><footer><button disabled={index === 0} onClick={previous}><ChevronLeft size={21}/>{t('common.back')}</button><div>{songs.map((item, itemIndex) => <span className={itemIndex === index ? 'active' : ''} key={`${item.id}-${itemIndex}`}/>)}</div><button disabled={index === songs.length - 1} onClick={next}>{t('common.next')}<ChevronRight size={21}/></button></footer></div>
}

function EditSongDialog({song, onClose, onSave}) {
  const { t } = useI18n()
  const [title, setTitle] = useState(song.title)
  const [key, setKey] = useState(song.key === '–' ? '' : song.key || '')
  const [saving, setSaving] = useState(false)
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{t('songs.editTitle')}</p><h2>{t('songs.editHint')}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <label className="field"><span>{t('songs.songTitle')}</span><div><FileText size={18}/><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus/></div></label>
    <label className="field"><span>{t('songs.key')}</span><div><Music2 size={18}/><input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('songs.keyPlaceholder')}/></div></label>
    <div className="modal-actions"><button className="cancel-button" onClick={onClose} disabled={saving}>{t('common.cancel')}</button><button className="add-button compact" disabled={!title.trim() || saving} onClick={async () => { setSaving(true); try { await onSave({title: title.trim(), artist: song.artist, key: key.trim() || '–'}) } finally { setSaving(false) } }}><CheckCircle2 size={18}/>{saving ? t('common.saving') : t('songs.saveChanges')}</button></div>
  </section></div>
}

function SongEditorRoute({songs,setSongs,navigate}) {
  const { t } = useI18n()
  const {songId}=useParams();const song=songs.find((item)=>item.id===songId)
  if(!song)return <SimplePage eyebrow={t('songs.editor')} title={t('songs.notFound')} text={t('songs.notInLibrary')}/>
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
  const { t } = useI18n()
  const initialKey=germanKeys.includes(song.sourceKey||song.key)?(song.sourceKey||song.key):'D';const [text,setText]=useState('');const [sourceKey]=useState(initialKey);const [targetKey,setTargetKey]=useState(initialKey);const [currentKey,setCurrentKey]=useState(initialKey);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [saved,setSaved]=useState('');const [fontSize,setFontSize]=useState(16);const [columns,setColumns]=useState(1);const [autoScroll,setAutoScroll]=useState(false);const [bpm,setBpm]=useState(120);const [cajonOn,setCajonOn]=useState(false);const audioContextRef=useRef(null);const [view,setView]=useState(hasSongPdf(song)?'original':'edited')
  useEffect(()=>{analyzeSongChords(song.id).then((data)=>{setText(data.text);const tempo=data.text.match(/TEMPO:\s*(\d{2,3})\s*BPM/i);if(tempo)setBpm(Math.min(240,Math.max(40,Number(tempo[1]))));setLoading(false)}).catch((caught)=>{setError(caught.message);setLoading(false)})},[song.id])
  useEffect(()=>{if(!autoScroll)return;const timer=window.setInterval(()=>window.scrollBy({top:1,behavior:'auto'}),70);return()=>window.clearInterval(timer)},[autoScroll])
  useEffect(()=>{if(!cajonOn)return;const AudioContext=window.AudioContext||window.webkitAudioContext;const context=audioContextRef.current||new AudioContext();audioContextRef.current=context;context.resume();let beat=0;const strike=()=>{const now=context.currentTime;const strong=beat%4===0;const master=context.createGain();master.gain.setValueAtTime(strong?.11:.045,now);master.gain.exponentialRampToValueAtTime(.001,now+(strong?.14:.075));master.connect(context.destination);const length=Math.floor(context.sampleRate*(strong?.14:.075));const buffer=context.createBuffer(1,length,context.sampleRate);const data=buffer.getChannelData(0);for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*(1-i/length);const noise=context.createBufferSource();const filter=context.createBiquadFilter();filter.type='bandpass';filter.frequency.value=strong?720:1750;filter.Q.value=strong?.8:1.4;noise.buffer=buffer;noise.connect(filter);filter.connect(master);noise.start(now);if(strong){const tone=context.createOscillator();const toneGain=context.createGain();tone.frequency.setValueAtTime(115,now);tone.frequency.exponentialRampToValueAtTime(58,now+.11);toneGain.gain.setValueAtTime(.09,now);toneGain.gain.exponentialRampToValueAtTime(.001,now+.13);tone.connect(toneGain);toneGain.connect(context.destination);tone.start(now);tone.stop(now+.14)}beat+=1};strike();const timer=window.setInterval(strike,60000/bpm);return()=>window.clearInterval(timer)},[cajonOn,bpm])
  useEffect(()=>()=>{audioContextRef.current?.close()},[])
  const changeTargetKey=(next)=>{setText((current)=>transposeEditorText(current,currentKey,next));setCurrentKey(next);setTargetKey(next)}
  const saveEditor=async()=>{setSaving(true);setSaved('');try{await onSave({text:transposeEditorText(text,currentKey,sourceKey),sourceKey,targetKey});setSaved(t('songs.savedInKey', { key: targetKey }))}finally{setSaving(false)}}
  const originalUrl=songPdfUrl(song);const share=async()=>{const data=view==='original'?{title:song.title,url:new URL(originalUrl,window.location.origin).href}:{title:song.title,text:`${song.title}\n\n${text}`};if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url||data.text);setSaved(t('songs.copiedClipboard'))}}
  const download=async()=>{const link=document.createElement('a');if(view==='original'){try{const href=await authorizedObjectUrl(originalUrl);link.href=href;link.download=song.fileName||`${song.title}.pdf`;link.click();if(href.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(href),30000)}catch{link.href=originalUrl;link.download=song.fileName||`${song.title}.pdf`;link.click()}}else{link.href=URL.createObjectURL(new Blob([`${song.title}\n\n${text}`],{type:'text/plain;charset=utf-8'}));link.download=`${song.title}.txt`;link.click();URL.revokeObjectURL(link.href)}}
  const printSheet=async()=>{if(view==='original'){try{const href=await authorizedObjectUrl(originalUrl);window.open(`${href}#toolbar=1`,'_blank','noopener')}catch{window.open(`${originalUrl}#toolbar=1`,'_blank','noopener')}}else window.print()}
  return <div className={`${embedded?'song-editor-page':'modal-backdrop'}${homeEmbedded?' home-song-editor':''}`} onMouseDown={(event)=>!embedded&&event.target===event.currentTarget&&onClose()}>{embedded&&<button className="back-button editor-back" onClick={onClose}><ChevronLeft size={18}/>{t('songs.toLibrary')}</button>}<section className={embedded?'song-editor-surface':'modal modal-wide transpose-modal'}>{loading?<div className="analysis-loading"><Music2 size={30}/><strong>{t('songs.preparing')}</strong></div>:error?<div className="form-error analysis-error">{error}</div>:<><div className="editor-view-switch"><button className={view==='original'?'active':''} onClick={()=>setView('original')} disabled={!hasSongPdf(song)}>{t('songs.originalPdf')}</button><button className={view==='edited'?'active':''} onClick={()=>setView('edited')}>{t('songs.editKey')}</button><span>{view==='original'?t('songs.originalHint'):t('songs.editableHint')}</span></div><div className="sheet-toolbar"><label className={view==='original'?'tool-disabled':''}><span>{t('songs.changeKey')}</span><select disabled={view==='original'} value={targetKey} onChange={(event)=>changeTargetKey(event.target.value)}>{germanKeys.map((key)=><option key={key}>{key}</option>)}</select></label><div className={`tool-group${view==='original'?' tool-disabled':''}`}><span>{t('songs.columns')}</span><button disabled={view==='original'} className={columns===1?'active':''} onClick={()=>setColumns(1)}>1</button><button disabled={view==='original'} className={columns===2?'active':''} onClick={()=>setColumns(2)}><Columns2 size={18}/></button></div><div className={`tool-group font-tools${view==='original'?' tool-disabled':''}`}><span>{t('songs.font')}</span><button disabled={view==='original'} onClick={()=>setFontSize((size)=>Math.max(11,size-1))}>−</button><Type size={18}/><button disabled={view==='original'} onClick={()=>setFontSize((size)=>Math.min(28,size+1))}>+</button><button disabled={view==='original'} onClick={()=>setFontSize(16)} title={t('songs.resetFont')}><RotateCcw size={17}/></button></div><div className="tool-group scroll-tool"><span>{t('songs.autoScroll')}</span><button className={autoScroll?'active':''} onClick={()=>setAutoScroll((value)=>!value)}>{autoScroll?<Pause size={18}/>:<Play size={18}/>}</button></div><div className="tool-group cajon-tool"><span>{t('songs.cajon')}</span><input aria-label={t('songs.tempoAria')} type="number" min="40" max="240" value={bpm} onChange={(event)=>setBpm(Math.min(240,Math.max(40,Number(event.target.value)||40)))}/><button className={cajonOn?'active':''} onClick={()=>setCajonOn((value)=>!value)} title={t('songs.startCajon')}>{cajonOn?<Pause size={18}/>:<Play size={18}/>}</button></div><div className="tool-group sheet-actions"><span>{t('songs.sheet')}</span><button onClick={printSheet} title={t('songs.print')}><Printer size={18}/></button><button onClick={download} title={t('songs.download')}><Download size={18}/></button><button onClick={share} title={t('songs.share')}><Share2 size={18}/></button><button onClick={()=>document.documentElement.requestFullscreen?.()} title={t('songs.fullscreen')}><Maximize2 size={18}/></button></div></div>{view==='original'?<div className="original-pdf-sheet"><AuthorizedFrame title={`${song.title} – ${t('songs.originalPdf')}`} path={originalUrl} hash="#toolbar=0&navpanes=0&view=FitH"/></div>:<><article className="editor-paper"><header><div><h2>{song.title}</h2><p>{song.artist||t('brand.songbook')}</p><strong>{t('songs.editedVersion', { key: targetKey })}</strong></div><Music2 size={30}/></header><pre className={`chart-sheet columns-${columns}`} style={{fontSize}} contentEditable suppressContentEditableWarning spellCheck="false" onBlur={(event)=>{setText(event.currentTarget.innerText);setSaved('')}}>{text}</pre></article><div className="editor-bottom-actions">{saved&&<span className="editor-saved"><CheckCircle2 size={16}/>{saved}</span>}<button className="add-button compact" disabled={!text.trim()||saving} onClick={saveEditor}><CheckCircle2 size={18}/>{saving?t('common.saving'):t('songs.saveEdited', { key: targetKey })}</button></div></>}</>}</section></div>
}

function ScanDialog({onClose,onSave}) {
  const { t } = useI18n()
  const cameraRef=useRef(null);const galleryRef=useRef(null);const [title,setTitle]=useState('');const [pages,setPages]=useState([]);const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const add=files=>{const next=Array.from(files||[]).filter(file=>file.type.startsWith('image/'));if(!next.length)return;setPages(current=>[...current,...next.slice(0,8-current.length).map(file=>({id:crypto.randomUUID(),file,url:URL.createObjectURL(file)}))])}
  const remove=id=>setPages(current=>{const page=current.find(item=>item.id===id);if(page)URL.revokeObjectURL(page.url);return current.filter(item=>item.id!==id)})
  const move=(index,offset)=>setPages(current=>{const target=index+offset;if(target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next})
  return <div className="modal-backdrop"><section className="modal modal-wide scan-modal"><div className="modal-header"><div><p className="eyebrow">{t('scan.title')}</p><h2>{t('scan.subtitle')}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><div className="scan-guide"><span>1</span><p><strong>{t('scan.guide')}</strong><small>{t('scan.guideHint')}</small></p></div><input ref={cameraRef} className="file-input" type="file" accept="image/*" capture="environment" onChange={event=>{add(event.target.files);event.target.value=''}}/><input ref={galleryRef} className="file-input" type="file" accept="image/*" multiple onChange={event=>{add(event.target.files);event.target.value=''}}/><div className="scan-actions"><button className="scan-camera-button" onClick={()=>cameraRef.current?.click()}><FileText size={24}/><span><strong>{pages.length?t('scan.nextPage'):t('scan.openCamera')}</strong><small>{t('scan.upTo8')}</small></span></button><button className="scan-gallery-button" onClick={()=>galleryRef.current?.click()}><Upload size={21}/>{t('scan.pickImages')}</button></div>{pages.length>0&&<><label className="field scan-title"><span>{t('scan.songTitle')}</span><div><Music2 size={18}/><input value={title} onChange={event=>setTitle(event.target.value)} placeholder={t('scan.titlePlaceholder')} autoFocus/></div></label><div className="scan-pages">{pages.map((page,index)=><article key={page.id}><img src={page.url} alt={t('scan.pageAlt', { n: index+1 })}/><span>{t('scan.pageN', { n: index+1 })}</span><div><button disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button disabled={index===pages.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button onClick={()=>remove(page.id)}><Trash2 size={16}/></button></div></article>)}</div></>}{error&&<p className="form-error">{error}</p>}<div className="scan-processing-note"><CheckCircle2 size={18}/><span><strong>{t('scan.autoProcess')}</strong><small>{t('scan.processHint')}</small></span></div><div className="modal-actions"><button className="cancel-button" onClick={onClose} disabled={saving}>{t('common.back')}</button><button className="add-button compact" disabled={!title.trim()||!pages.length||saving} onClick={async()=>{setSaving(true);setError('');try{await onSave(title.trim(),pages)}catch(e){setError(e.message);setSaving(false)}}}><Upload size={18}/>{saving?t('scan.processing'):t('scan.create')}</button></div></section></div>
}

function ImportDialog({onClose, onImport, onScan}) {
  const { t } = useI18n()
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
    if (invalid) { setError(t('import.onlyPdf', { name: invalid.name })); return }
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
      <div className="modal-header"><div><p className="eyebrow">{t('import.title')}</p><h2 id="import-title">{t('import.subtitle')}</h2></div><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X size={20}/></button></div>
      <p className="modal-copy">{t('import.hint')}</p>
      <div className="import-methods"><button className="scan-start" onClick={()=>setScanOpen(true)}><span><FileText size={23}/></span><div><strong>{t('import.scanBook')}</strong><small>{t('import.scanHint')}</small></div><ChevronRight size={18}/></button><span>{t('import.orPdfs')}</span></div>
      <input ref={inputRef} className="file-input" type="file" accept="application/pdf,.pdf" multiple onChange={(e) => choose(e.target.files)}/>
      <button className={`dropzone${items.length ? ' has-files' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files) }}>
        {items.length ? <><CheckCircle2 size={26}/><strong>{items.length === 1 ? t('import.nPdfSelected', { count: items.length }) : t('import.nPdfsSelected', { count: items.length })}</strong><span>{t('import.addMore')}</span></> : <><Upload size={30}/><strong>{t('import.dropEmpty')}</strong><span>{t('import.dropOrClick')}</span></>}
      </button>
      {error && <p className="form-error">{error}</p>}
      {items.length > 0 && <div className="import-list"><div className="import-list-head"><p className="eyebrow">{t('import.order')}</p><span>{t('import.sortHint')}</span></div>{items.map((item, index) => <div className="import-item" key={item.id}><span className="order-number">{index + 1}</span><div className="import-main"><input value={item.title} onChange={(e) => updateTitle(item.id, e.target.value)} aria-label={t('import.titleOf', { file: item.file.name })}/><small>{item.file.name} · {(item.file.size / 1024 / 1024).toFixed(2)} MB</small></div><div className="order-actions"><button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('import.moveUp')}><ArrowUp size={17}/></button><button className="icon-button" disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={t('import.moveDown')}><ArrowDown size={17}/></button><button className="icon-button danger" onClick={() => remove(item.id)} aria-label={t('common.remove')}><Trash2 size={17}/></button></div></div>)}</div>}
      {saveError && <p className="form-error">{saveError}</p>}
      {saving && <div className="save-progress"><span style={{width: `${progress}%`}}/><small>{t('import.saving')}</small></div>}
      <div className="modal-actions"><button className="cancel-button" onClick={onClose} disabled={saving}>{t('common.cancel')}</button><button className="add-button compact" disabled={!valid || saving} onClick={async () => { setSaving(true); setSaveError(''); setProgress(12); try { const payload = items.map((item) => ({ song: {title: item.title.trim(), artist: t('import.artistDefault'), key: '–', bpm: '–', duration: '–'}, file: item.file })); setProgress(35); await onImport(payload); setProgress(100) } catch (caught) { console.error(caught); setSaveError(caught?.name === 'QuotaExceededError' ? t('import.quota') : t('import.failed', { error: caught?.message || t('import.failedGeneric') })); setSaving(false); setProgress(0) } }}><Upload size={18}/>{saving ? t('import.savingN', { count: items.length }) : t('import.nSongs', { count: items.length || '' })}</button></div>
    </section>
  </div>
}


export default App

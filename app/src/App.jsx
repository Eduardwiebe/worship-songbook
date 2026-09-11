import { useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Home, Music2, ListMusic, Users, CalendarDays, Plus, Settings, Search,
  Upload, FileMusic, Play, Pause, Clock3, MoreHorizontal, X, FileText, CheckCircle2, Eye, ArrowUp, ArrowDown, Trash2, ChevronLeft, ChevronRight, Pencil, Printer, Download, Share2, Maximize2, Columns2, Type, RotateCcw, UserRound, LogOut, LockKeyhole, Heart, Menu, Copy, Link2,
} from 'lucide-react'
import './App.css'
import './extra.css'
import { analyzeSongChords, deleteSong, getImportedSongs, getSongOriginalSnapshot, getSongVariants, hasSongPdf, openSongChart, openSongPdf, previewScanPdf, saveImportedSongs, saveScanImport, saveSongVariant, songChartUrl, songPdfUrl, updateSong, resolveSongCover, resolveSongYoutube, songCoverPath } from './songStore'
import { createSet, deleteSet, getSets, saveSet } from './setStore'
import { isProbablyOffline, prefetchSetCharts } from './offlineCache'
import { deleteMember, getTeam, memberPhoto, saveMember } from './teamStore'
import { createAppointment, deleteAppointment, getAppointments } from './scheduleStore'
import { changePassword, deleteProfilePhoto, getCurrentUser, login, logout, onNativeAuthFailure, profilePhotoUrl, register, updateProfile, uploadProfilePhoto } from './authStore'
import { AuthorizedFrame, AuthorizedImg } from './AuthorizedMedia'
import { installNativeExternalLinkHandler, openExternal } from './openExternal'
import { authorizedObjectUrl, apiFetch, apiUrl } from './apiConfig'
import { approveBandJoinRequest, bandLogoUrl, createBand, createBandInvite, deleteBand, deleteBandLogo, getBands, getBandInvites, getBandJoinRequests, getBandMembers, getMyJoinRequests, joinBandByCode, rejectBandJoinRequest, requestBandJoin, searchBands, selectBand, selectPersonal, updateBand, uploadBandLogo } from './bandStore'
import Onboarding from './onboarding/Onboarding'
import { getOnboarding, resetOnboarding, dismissOnboarding } from './onboardingStore'
import { useI18n, tStatic } from './i18n'
import { useTheme } from './theme.jsx'
import { AuthScreen, PasswordRequired } from './AuthScreen'
import SettingsPage from './SettingsPage'
import { AboutDialog, UpdateDialog } from './AboutDialogs'
import { BrandMark } from './BrandMark'
import {
  GERMAN_EDITOR_KEYS,
  applyEditorKeyChange,
  displayEditorKeyLabel,
  normalizeEditorKey,
  projectEditorSnapshot,
  resolveEditorSnapshot,
  simplifyChordToken,
  transposeEditorText,
} from '../../lib/editorKey.mjs'
import {
  softFormatChordChart,
  parseChartBlocks,
  normalizeChartInnerText,
  wordStacksToChordLyric,
  formatSectionLabel,
  isRedundantKeyMeta,
} from '../../lib/chartLayout.mjs'
import { parseTempoBpm, clampTempoBpm } from '../../lib/leadsheetAnalysis.mjs'
import { playCajonHit, playCajonHtmlHit, preloadCajonSample, unlockCajonAudio, useCajon } from './cajonPlayer'
import { installNativeDesktopChrome } from './nativeDesktop'
import { ModalBackdrop } from './ModalBackdrop'
import { GuitarTunerModal } from './GuitarTunerModal'
import { blurActiveElement, dismissModal, lockBodyScroll, scheduleViewportRestore, unlockBodyScroll } from './modalLock'
import { useAvoidMobileAutoFocus } from './useMobileFormFocus'
import { URL_APP, URL_EDUARD_WIEBE, URL_LYRUMA_STUDIO, APP_VERSION } from './appMeta'
import {
  SCAN_IMAGE_ACCEPT,
  SCAN_MIXED_ACCEPT,
  canSubmitScan,
  classifyScanFile,
  isLikelyScanImageFile,
  resolveScanTitle,
  titleFromScanFile,
} from '../../lib/scanFileTypes.mjs'

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
  const [offlineMode,setOfflineMode]=useState(()=>isProbablyOffline())
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
  useEffect(()=>{
    const sync=()=>setOfflineMode(isProbablyOffline())
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    sync()
    return ()=>{
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  },[])
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
  useEffect(() => {
    if (!user || !songs.length) return
    let cancelled = false
    const missing = songs.filter((song) => song.id && !song.hasCover).slice(0, 8)
    ;(async () => {
      for (const song of missing) {
        if (cancelled) return
        try {
          const resolved = await resolveSongCover(song.id)
          if (cancelled || !resolved?.hasCover) continue
          setSongs((current) => current.map((item) => item.id === song.id
            ? { ...item, hasCover: true, coverUrl: resolved.coverUrl || `/api/songs/${song.id}/cover`, coverSource: resolved.coverSource || '' }
            : item))
        } catch (error) {
          console.warn('cover backfill failed', song.id, error)
        }
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, songs.map((song) => `${song.id}:${song.hasCover ? 1 : 0}`).join('|')]) /* cover-backfill */

  useEffect(()=>{
    if(!menuOpen)return

    const onKey=event=>{
      if(event.key==='Escape')setMenuOpen(false)
    }

    lockBodyScroll()
    window.addEventListener('keydown',onKey)

    return ()=>{
      unlockBodyScroll()
      window.removeEventListener('keydown',onKey)
    }
  },[menuOpen])

  const closeMenu=()=>setMenuOpen(false)
  const go=to=>{
    closeMenu()
    navigate(to)
  }

  if(authLoading)return <div className="auth-loading"><BrandMark /><p>{t('loading')}</p></div>
  if(!user)return <>
    <AuthScreen onAuthenticated={setUser}/>
    {aboutOpen&&<AboutDialog onClose={()=>setAboutOpen(false)}/>}
    {updateOpen&&<UpdateDialog result={updateResult} onClose={()=>{setUpdateOpen(false);setUpdateResult(undefined)}}/>}
  </>
  if(user.mustChangePassword)return <PasswordRequired user={user} onChanged={setUser} onLogout={async()=>{await logout();setUser(null)}}/>
  if(onboarding===null)return <div className="auth-loading"><BrandMark /><p>{t('onboardingLoading')}</p></div>
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
  return <div className="app-shell">{offlineMode?<div className="offline-banner" role="status">{t('offline.banner')}</div>:null}
    <aside className="sidebar">
      <NavLink className="brand" to="/" end aria-label={t('brand.songbook')}><BrandMark /><div><strong>{t('brand.songbook')}</strong></div></NavLink>
      <nav className="nav">{navItems.map(([to, label, Icon]) =>
        <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => `nav-item${isActive ? ' active' : ''}`}><Icon size={19}/>{label}</NavLink>
      )}</nav>
      <div className="sidebar-bottom">
        <button className="band-switch" onClick={()=>navigate('/bands')}><span className="band-switch-icon"><Users size={17}/></span><span><small>{t('nav.activeScope')}</small><b>{activeBand?.name||t('nav.personalSongbook')}</b></span><ChevronRight size={16}/></button>
        <button className="add-button" onClick={openImport}><Plus size={19}/>{t('nav.add')}</button>
        <a className="nav-item install-nav" href={`${URL_APP}/install/`} target="_blank" rel="noreferrer" onClick={(e)=>{e.preventDefault();openExternal(`${URL_APP}/install/`)}}><Download size={19}/>{t('nav.install')}</a>
        <NavLink to="/einstellungen" className={({isActive}) => `nav-item${isActive ? ' active' : ''}`}><Settings size={19}/>{t('nav.settings')}</NavLink>
        <button className="nav-item account-nav" onClick={()=>navigate('/einstellungen')}>{user.hasPhoto?<AuthorizedImg className="account-nav-photo" path={profilePhotoUrl(user)} alt=""/>:<UserRound size={19}/>}<span><b>{user.name}</b><small>{user.role==='admin'?t('nav.admin'):t('nav.mySongbook')}</small></span></button>
      </div>
    </aside>

    <header className="mobile-topbar">
      <div className="mobile-topbar-brand">
        <BrandMark className="header-songbook-mark" />
        <strong>{t('brand.songbook')}</strong>
      </div>
      <div className="mobile-topbar-actions">
        <a
          className="mobile-install-link"
          href={`${URL_APP}/install/`}
          target="_blank"
          rel="noreferrer"
          onClick={(e)=>{e.preventDefault();openExternal(`${URL_APP}/install/`)}}
        >
          <Download size={18}/>
          <span>{t('nav.install')}</span>
        </a>
        <button
          type="button"
          className="menu-toggle"
          aria-label={t('nav.openMenu')}
          aria-expanded={menuOpen}
          onClick={()=>setMenuOpen(true)}
        >
          <Menu size={22}/>
        </button>
      </div>
    </header>

    {menuOpen&&
      <>
        <button type="button" className="nav-backdrop" aria-label={t('nav.closeMenu')} onClick={closeMenu}/>
        <aside className="nav-drawer" role="dialog" aria-modal="true" aria-label={t('nav.mainNav')}>
          <div className="nav-drawer-head">
            <NavLink className="brand" to="/" end onClick={closeMenu} aria-label={t('brand.songbook')}>
              <BrandMark />
              <div><strong>{t('brand.songbook')}</strong></div>
            </NavLink>
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
            <a className="nav-item install-nav" href={`${URL_APP}/install/`} target="_blank" rel="noreferrer" onClick={(e)=>{e.preventDefault();closeMenu();openExternal(`${URL_APP}/install/`)}}><Download size={19}/>{t('nav.install')}</a>
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
    {dialogOpen && <ImportDialog onClose={() => setDialogOpen(false)} onImport={async (items) => { const storedSongs = await saveImportedSongs(items); setSongs((current) => [...storedSongs, ...current]); setDialogOpen(false); navigate('/songs') }} onScan={async(title,payload)=>{const song=await saveScanImport(title,payload);if(song?.needsPageSelection)throw new Error(song.error||'Bitte Song-Seiten auswählen.');setSongs(current=>[song,...current]);setDialogOpen(false);navigate(`/songs/${song.id}/editor`)}}/>} 
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
  const donationUrl='https://www.paypal.com/donate?business=eduardwiebe77%40gmail.com&no_recurring=0&item_name=Songbook+Band+Open+Source+Entwicklung&currency_code=EUR'
  return <footer className="app-footer"><section className="donation-card"><span className="donation-heart"><Heart size={23}/></span><div><strong>{t('footer.supportTitle')}</strong><p>{t('footer.supportText')}</p></div><a href={donationUrl} target="_blank" rel="noreferrer"><Heart size={17}/>{t('footer.paypal')}</a></section><div className="footer-main"><div><strong>{t('brand.songbook')}</strong><span>{t('footer.openSource')}</span></div><nav aria-label={t('footer.ariaWebsites')}><a href={URL_LYRUMA_STUDIO} target="_blank" rel="noreferrer">Lyruma Studio</a><a href="https://lyruma.app" target="_blank" rel="noreferrer">Lyruma App</a><a href={URL_EDUARD_WIEBE} target="_blank" rel="noreferrer">Eduard Wiebe</a></nav></div><div className="footer-bottom"><nav aria-label={t('footer.ariaLegal')}><a href={`${URL_APP}/install/`} target="_blank" rel="noreferrer" onClick={(e)=>{e.preventDefault();openExternal(`${URL_APP}/install/`)}}>{t('footer.install')}</a><a href="/nutzungsbedingungen.html" target="_blank" rel="noreferrer">{t('footer.terms')}</a><a href="/datenschutz.html" target="_blank" rel="noreferrer">{t('footer.privacy')}</a><a href="/impressum.html" target="_blank" rel="noreferrer">{t('footer.imprint')}</a></nav><div className="social-links" aria-label={t('footer.ariaSocial')}>{social.map(([name,url,glyph])=><a key={name} href={url} target="_blank" rel="noreferrer" title={name} aria-label={name}><span aria-hidden="true">{glyph}</span></a>)}<a href="https://www.tiktok.com/@lyrumastudio" target="_blank" rel="noreferrer" title="TikTok" aria-label="TikTok" className="tiktok-icon"><span aria-hidden="true">♪</span></a></div></div><p>{t('footer.rights', { year: new Date().getFullYear() })}</p></footer>
}

function Header({title, subtitle}) {
  const { t } = useI18n()
  return <header className="topbar app-header page-header">
    <div className="header-brand">
      <BrandMark className="header-songbook-mark" />
      <div>
        <p className="eyebrow header-brand-eyebrow">{t('header.eyebrow')}</p>
        <h1>{title}</h1>
        {subtitle&&<p className="subtitle">{subtitle}</p>}
      </div>
    </div>
    <a
      className="header-install-cta"
      href={`${URL_APP}/install/`}
      target="_blank"
      rel="noreferrer"
      onClick={(e)=>{e.preventDefault();openExternal(`${URL_APP}/install/`)}}
    >
      <Download size={17}/>{t('nav.install')}
    </a>
  </header>
}

function HomePage({songs, setSongs, sets, openImport, openSetDialog, navigate}) {
  const { t } = useI18n()
  const [query,setQuery]=useState('');const [activeSlide,setActiveSlide]=useState(0);const [playing,setPlaying]=useState(false);const [selectedSongId,setSelectedSongId]=useState('');const shown=songs.filter((song)=>`${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase())).slice(0,12);const selectedSong=songs.find((song)=>song.id===selectedSongId)
  const inspirationSlides=[{kind:'intro',title:t('home.introTitle'),artist:t('home.introArtist'),image:'/worship-neutral.svg'},{kind:'video',title:'Nichts unmöglich',artist:'ICF Karlsruhe Music',videoId:'neZnq_5bXkA'},{kind:'video',title:'Generation',artist:'X Worship',videoId:'ir3ZRcUsdW0'}];const safeSlide=activeSlide<inspirationSlides.length?activeSlide:0;const slide=inspirationSlides[safeSlide];const slideImage=slide.videoId?`https://i.ytimg.com/vi/${slide.videoId}/hqdefault.jpg`:slide.image
  return <><Header title={t('home.title')} subtitle={t('home.subtitle')}/>
    <label className="home-search"><Search size={24}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={t('home.searchPlaceholder')} autoComplete="off"/>{query&&<button onClick={()=>setQuery('')} aria-label={t('home.clearSearch')}><X size={18}/></button>}</label>
    <section className={`home-hero inspiration-hero${playing?' is-playing':''}`} aria-label={t('home.inspirationAria')}><img className="hero-background" src={slideImage} alt=""/><div className="hero-shade"/>{playing&&slide.videoId?<div className="hero-player"><iframe src={`https://www.youtube-nocookie.com/embed/${slide.videoId}?autoplay=1&rel=0`} title={t('home.youtubeTitle', { title: slide.title })} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/><button onClick={()=>setPlaying(false)} aria-label={t('home.closeVideo')}><X size={20}/>{t('common.close')}</button></div>:<><button className="hero-arrow hero-arrow-left" onClick={()=>{setPlaying(false);setActiveSlide((safeSlide-1+inspirationSlides.length)%inspirationSlides.length)}} aria-label={t('home.prev')}><ChevronLeft size={25}/></button><div className={`hero-content${slide.kind==='intro'?' intro-slide':''}`}>{slide.kind==='video'&&<img className="hero-poster" src={slideImage} alt={t('home.coverAlt', { title: slide.title })}/>}<div className="hero-copy"><p className="hero-label">{slide.kind==='intro'?t('brand.songbook'):t('home.newWorship')}</p><h2>{slide.title}</h2><p className="hero-date">{slide.artist}</p>{slide.kind==='intro'?<div className="intro-features"><span>{t('home.featureLyrics')}</span><span>{t('home.featureChords')}</span><span>{t('home.featureSets')}</span><span>{t('home.featurePlay')}</span></div>:<button className="hero-set-link" onClick={()=>setPlaying(true)}><Play size={17}/>{t('home.toSong')}</button>}</div></div><button className="hero-arrow hero-arrow-right" onClick={()=>{setPlaying(false);setActiveSlide((safeSlide+1)%inspirationSlides.length)}} aria-label={t('home.next')}><ChevronRight size={25}/></button></>}<div className="hero-dots">{inspirationSlides.map((item,index)=><button key={item.title} className={index===safeSlide?'active':''} onClick={()=>{setPlaying(false);setActiveSlide(index)}} aria-label={t('home.slideN', { n: index+1 })}/>)}</div></section>
    {selectedSong?<TransposeDialog embedded homeEmbedded song={selectedSong} onClose={()=>setSelectedSongId('')} onKeysResolved={(keys)=>setSongs((current)=>current.map((item)=>item.id===selectedSong.id?{...item,...keys}:item))} onSave={async(values)=>{const variant=await saveSongVariant(selectedSong.id,values);setSongs((current)=>current.map((item)=>item.id===selectedSong.id?{...item,key:variant.targetKey,sourceKey:variant.sourceKey,originalKey:variant.sourceKey,preferredKey:variant.targetKey,sheetColumns:variant.sheetColumns??values.sheetColumns??item.sheetColumns,sheetFontSize:variant.sheetFontSize??values.sheetFontSize??item.sheetFontSize,variantKeys:Array.from(new Set([variant.targetKey,...(item.variantKeys||[])]))}:item));return variant}}/>:<><section className="home-section"><div className="home-section-head"><div><p className="eyebrow">{t('home.library')}</p><h2>{query?t('home.searchResults', { query }):t('home.openSongs')}</h2></div><button className="text-button" onClick={openImport}><Plus size={17}/>{t('home.addSong')}</button></div>{shown.length?<div className="song-tile-row">{shown.map((song,index)=>{const songKey=song.preferredKey||song.key;return <button className="song-tile" key={song.id} onClick={()=>setSelectedSongId(song.id)} type="button"><span className={`song-cover cover-tone-${index%6}${song.hasCover?' has-cover':''}`}>{song.hasCover?<AuthorizedImg className="song-cover-image" path={songCoverPath(song)} alt=""/>:null}{songKey?<span className="song-key-badge" title={t('home.key', { key: songKey })} aria-label={t('home.key', { key: songKey })}>{songKey}</span>:null}<span className="song-cover-scrim"><strong className="song-cover-title">{song.title}</strong></span><Music2 className="song-cover-note" size={18} aria-hidden="true"/><i className="song-cover-play"><Play size={17}/></i></span></button>})}{!query&&songs.length>12&&<button className="song-tile more-tile" onClick={()=>navigate('/songs')} type="button"><span className="more-cover"><Plus size={28}/><strong>{t('home.allSongs')}</strong><small>{t('home.fullLibrary')}</small></span></button>}</div>:<div className="empty-state small"><Search size={30}/><h3>{t('home.noSongTitle')}</h3><p>{t('home.noSongText')}</p></div>}</section>
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
      <div className="song-number">{String(index + 1).padStart(2, '0')}</div><div className={`song-icon${song.hasCover?' has-cover':''}`}>{song.hasCover?<AuthorizedImg className="song-row-cover" path={songCoverPath(song)} alt=""/>:<FileMusic size={21}/>}</div><div className="song-main"><strong>{song.title}</strong><span>{song.artist}{song.fileName ? ` · ${(song.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}{song.preferredKey?` · ${t('songs.versionKey', { key: song.preferredKey })}`:''}{song.isProtected?` · ${t('songs.protected')}`:''}</span></div><div className="song-meta"><span><b>{song.key || '–'}</b> {t('songs.key')}</span><span><b>{song.bpm || '–'}</b> {t('songs.bpm')}</span><span><Clock3 size={14}/>{song.duration || '–'}</span></div>{hasSongPdf(song) && <button className="icon-button" title={t('songs.openPdf')} onClick={() => openSongPdf(song)}><Eye size={18}/></button>}{onTranspose&&<button className="transpose-button" title={t('songs.transpose')} onClick={()=>onTranspose(song)}><Music2 size={17}/></button>}{onEdit ? <button className="icon-button" title={t('songs.edit')} onClick={() => onEdit(song)}><Pencil size={17}/></button> : <button className="icon-button"><MoreHorizontal size={18}/></button>}{onDelete && !song.isProtected && <button className="desktop-delete" title={t('songs.deleteSongPdf')} onClick={() => onDelete(song)}><Trash2 size={18}/></button>}
    </article>
  </div>
}

function SimplePage({eyebrow, title, text}) {
  const { t } = useI18n()
  return <><Header title={title} subtitle={text}/><section className="panel placeholder"><p className="eyebrow">{eyebrow}</p><h2>{t('simple.comingSoon', { title })}</h2><p>{t('simple.comingSoonBody')}</p></section></>
}

function BandsPage({bands}) {
  const { t } = useI18n()
  const avoidAutoFocus=useAvoidMobileAutoFocus()
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
  const [copiedInviteId,setCopiedInviteId]=useState('')
  const [searchParams,setSearchParams]=useSearchParams()
  const joinSectionRef=useRef(null)

  const inviteShareUrl=code=>`${URL_APP}/join?code=${encodeURIComponent(code)}`

  const normalizeInviteCode=value=>String(value||'')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g,'')
    .slice(0,8)

  const copyInviteValue=async(value,inviteId='')=>{
    try{
      await navigator.clipboard.writeText(value)
      setCopiedInviteId(inviteId||value)
      setTimeout(()=>setCopiedInviteId(current=>current===(inviteId||value)?'':current),2200)
    }catch{
      setError(t('bands.copyFailed'))
    }
  }

  useEffect(()=>{
    const fromQuery=normalizeInviteCode(searchParams.get('code')||searchParams.get('join')||'')
    let fromStorage=''
    try{fromStorage=normalizeInviteCode(sessionStorage.getItem('songbook-pending-invite')||'')}catch{}
    const code=fromQuery||fromStorage
    if(!code)return

    setInviteCode(code)
    setJoinInfo(t('bands.codePrefill',{code}))
    try{sessionStorage.removeItem('songbook-pending-invite')}catch{}

    if(fromQuery){
      const next=new URLSearchParams(searchParams)
      next.delete('code')
      next.delete('join')
      setSearchParams(next,{replace:true})
    }

    requestAnimationFrame(()=>{
      joinSectionRef.current?.scrollIntoView({behavior:'smooth',block:'start'})
    })
  },[])

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

    Promise.allSettled([
      getBandJoinRequests(),
      getBandInvites(active.id),
    ]).then(results=>{
      if(!current)return
      const [requestsResult,invitesResult]=results
      if(requestsResult.status==='fulfilled'){
        setJoinRequests(requestsResult.value.filter(item=>item.bandId===active.id))
      }else if(requestsResult.reason?.message){
        setError(requestsResult.reason.message)
      }
      if(invitesResult.status==='fulfilled'){
        setInvites(invitesResult.value)
      }else if(invitesResult.reason?.message){
        setError(invitesResult.reason.message)
      }
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
      const normalized={
        ...invite,
        active:invite.active!==false,
        shareUrl:invite.shareUrl||inviteShareUrl(invite.code),
      }
      setInvites(current=>[normalized,...current.filter(item=>item.id!==normalized.id)])
      try{
        const rows=await getBandInvites(active.id)
        setInvites(rows)
      }catch{
        /* keep optimistic row */
      }
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
    blurActiveElement()
    setEditor(null)
    setName('')
    setDescription('')
    setLogoFile(null)
    setLogoPreview('')
    scheduleViewportRestore('band-editor-close')
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
                autoFocus={!avoidAutoFocus}
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
            {invites.filter(invite=>invite.active!==false).length
              ? <div className="invite-list">
                  {invites.filter(invite=>invite.active!==false).map(invite=>{
                    const share=invite.shareUrl||inviteShareUrl(invite.code)
                    return <article key={invite.id}>
                      <code>{invite.code}</code>
                      <span>{t('bands.codeUsage', { used: invite.useCount, max: invite.maxUses, date: new Date(invite.expiresAt).toLocaleDateString() })}</span>
                      <a className="invite-share-link" href={share} target="_blank" rel="noreferrer">{share}</a>
                      <div className="invite-actions">
                        <button type="button" onClick={()=>copyInviteValue(invite.code,`${invite.id}-code`)}>
                          <Copy size={14}/>{copiedInviteId===`${invite.id}-code`?t('bands.copied'):t('bands.copyCode')}
                        </button>
                        <button type="button" onClick={()=>copyInviteValue(share,`${invite.id}-link`)}>
                          <Link2 size={14}/>{copiedInviteId===`${invite.id}-link`?t('bands.copied'):t('bands.copyLink')}
                        </button>
                      </div>
                    </article>
                  })}
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

    <section className="panel band-access-panel band-join-panel" ref={joinSectionRef}>
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
  const close=()=>dismissModal(onClose)
  const avoidAutoFocus=useAvoidMobileAutoFocus()
  const [name,setName]=useState('');const [roles,setRoles]=useState([]);const [isLeader,setIsLeader]=useState(false);const [isOrganizer,setIsOrganizer]=useState(false);const [isDesigner,setIsDesigner]=useState(false);const [isTechnician,setIsTechnician]=useState(false);const [photo,setPhoto]=useState(null);const [preview,setPreview]=useState('');const [saving,setSaving]=useState(false)
  const toggle=(role)=>setRoles((current)=>current.includes(role)?current.filter((item)=>item!==role):[...current,role])
  return <ModalBackdrop onClose={onClose}><section className="modal modal-wide"><div className="modal-header"><div><p className="eyebrow">{t('nav.team')}</p><h2>{t('team.add')}</h2></div><button className="icon-button" onClick={close}><X size={20}/></button></div><div className="member-form-head"><label className="photo-picker"><input type="file" accept="image/*" onChange={(event)=>{const file=event.target.files?.[0];if(file){setPhoto(file);setPreview(URL.createObjectURL(file))}}}/>{preview?<img src={preview} alt={t('team.previewAlt')}/>:<><b>{name.trim()?initials(name):'+'}</b><span>{t('team.photo')}</span></>}</label><label className="field grow"><span>{t('team.name')}</span><div><Users size={18}/><input value={name} onChange={(event)=>setName(event.target.value)} placeholder={t('team.namePlaceholder')} autoFocus={!avoidAutoFocus}/></div><small>{t('team.initials')} <strong>{name.trim()?initials(name):'–'}</strong></small></label></div><div className="role-field"><span>{t('team.roles')}</span><div className="role-options">{roleOptions.map((role)=><button type="button" className={roles.includes(role)?'selected':''} onClick={()=>toggle(role)} key={role}>{role}</button>)}</div></div><div className="responsibility-options"><label><input type="checkbox" checked={isLeader} onChange={(event)=>setIsLeader(event.target.checked)}/><span><strong>{t('team.leader')}</strong><small>{t('team.leaderHint')}</small></span></label><label><input type="checkbox" checked={isOrganizer} onChange={(event)=>setIsOrganizer(event.target.checked)}/><span><strong>{t('team.organizer')}</strong><small>{t('team.organizerHint')}</small></span></label><label><input type="checkbox" checked={isDesigner} onChange={(event)=>setIsDesigner(event.target.checked)}/><span><strong>{t('team.designer')}</strong><small>{t('team.designerHint')}</small></span></label><label><input type="checkbox" checked={isTechnician} onChange={(event)=>setIsTechnician(event.target.checked)}/><span><strong>{t('team.technician')}</strong><small>{t('team.technicianHint')}</small></span></label></div><div className="modal-actions"><button className="cancel-button" onClick={close}>{t('common.cancel')}</button><button className="add-button compact" disabled={!name.trim()||saving} onClick={async()=>{setSaving(true);try{await onSave({name:name.trim(),roles,isLeader,isOrganizer,isDesigner,isTechnician,photo})}finally{setSaving(false)}}}><Plus size={18}/>{saving?t('common.saving'):t('common.add')}</button></div></section></ModalBackdrop>
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
  const close=()=>dismissModal(onClose)
  const initialSet=sets.find((set)=>set.id===initialSetId);const [setId,setSetId]=useState(initialSetId||sets[0]?.id||'');const [type,setType]=useState('rehearsal');const [title,setTitle]=useState(appointmentTypes.rehearsal);const [date,setDate]=useState('');const [time,setTime]=useState('19:30');const [location,setLocation]=useState([initialSet?.band,initialSet?.venue].filter(Boolean).join(' in '));const [notes,setNotes]=useState('');const [saving,setSaving]=useState(false)
  return <ModalBackdrop onClose={onClose}><section className="modal"><div className="modal-header"><div><p className="eyebrow">{t('appointments.dialogEyebrow')}</p><h2>{t('appointments.dialogTitle')}</h2></div><button className="icon-button" onClick={close}><X size={20}/></button></div><label className="field"><span>{t('appointments.relatedSet')}</span><div><ListMusic size={18}/><select value={setId} onChange={(event)=>setSetId(event.target.value)}>{sets.map((set)=><option value={set.id} key={set.id}>{set.title} · {formatDate(set.date)}</option>)}</select></div></label><label className="field"><span>{t('appointments.typeLabel')}</span><div><CalendarDays size={18}/><select value={type} onChange={(event)=>{setType(event.target.value);setTitle(appointmentTypes[event.target.value])}}>{appointmentTypeKeys.map((value)=><option value={value} key={value}>{appointmentTypes[value]}</option>)}</select></div></label><label className="field"><span>{t('appointments.title')}</span><div><FileText size={18}/><input value={title} onChange={(event)=>setTitle(event.target.value)}/></div></label><div className="dialog-columns"><label className="field"><span>{t('appointments.date')}</span><div><CalendarDays size={18}/><input type="date" value={date} onChange={(event)=>setDate(event.target.value)}/></div></label><label className="field"><span>{t('appointments.time')}</span><div><Clock3 size={18}/><input type="time" value={time} onChange={(event)=>setTime(event.target.value)}/></div></label></div><label className="field"><span>{t('appointments.location')}</span><div><Home size={18}/><input value={location} onChange={(event)=>setLocation(event.target.value)} placeholder={t('appointments.locationPlaceholder')}/></div></label><label className="field"><span>{t('appointments.notes')}</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder={t('appointments.notesPlaceholder')}/></label><div className="modal-actions"><button className="cancel-button" onClick={close}>{t('common.cancel')}</button><button className="add-button compact" disabled={!setId||!title.trim()||!date||saving} onClick={async()=>{setSaving(true);try{await onSave({setId,type,title:title.trim(),date,time,location,notes})}finally{setSaving(false)}}}><Plus size={18}/>{saving?t('common.saving'):t('appointments.save')}</button></div></section></ModalBackdrop>
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
  const close=()=>dismissModal(onClose)
  const avoidAutoFocus=useAvoidMobileAutoFocus()
  const [title, setTitle] = useState(t('sets.defaultTitle'))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [eventTime, setEventTime] = useState('')
  const [arrivalTime, setArrivalTime] = useState('')
  const [band, setBand] = useState('')
  const [theme, setTheme] = useState('')
  const [venue, setVenue] = useState('')
  return <ModalBackdrop onClose={onClose}><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{t('sets.planning')}</p><h2>{t('sets.new')}</h2></div><button className="icon-button" onClick={close}><X size={20}/></button></div>
    <label className="field"><span>{t('sets.name')}</span><div><ListMusic size={18}/><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!avoidAutoFocus}/></div></label>
    <label className="field"><span>{t('sets.bandProject')}</span><div><Users size={18}/><input value={band} onChange={(e)=>setBand(e.target.value)} placeholder={t('sets.bandPlaceholder')}/></div></label>
    <label className="field"><span>{t('sets.theme')}</span><div><FileText size={18}/><input value={theme} onChange={(e)=>setTheme(e.target.value)} placeholder={t('sets.themePlaceholder')}/></div></label>
    <label className="field"><span>{t('sets.venue')}</span><div><Home size={18}/><input value={venue} onChange={(e)=>setVenue(e.target.value)} placeholder={t('sets.venuePlaceholder')}/></div></label>
    <label className="field"><span>{t('sets.date')}</span><div><CalendarDays size={18}/><input type="date" value={date} onChange={(e) => setDate(e.target.value)}/></div></label>
    <label className="field"><span>{t('sets.startTime')}</span><div><Clock3 size={18}/><input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)}/></div></label>
    <label className="field"><span>{t('sets.meetFrom')}</span><div><Clock3 size={18}/><input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)}/></div></label>
    <div className="modal-actions"><button className="cancel-button" onClick={close}>{t('common.cancel')}</button><button className="add-button compact" disabled={!title.trim()} onClick={() => onCreate({title: title.trim(), date, eventTime, arrivalTime, band, theme, venue})}><Plus size={18}/>{t('sets.create')}</button></div>
  </section></ModalBackdrop>
}

function SetDetailPage({sets, songs, team, updateSets, navigate}) {
  const { t } = useI18n()
  const {setId} = useParams()
  const set = sets.find((item) => item.id === setId)
  const [running, setRunning] = useState(false)
  useEffect(()=>{
    if(!set||isProbablyOffline())return
    let cancelled=false
    prefetchSetCharts(set, songs, { apiFetch, apiUrl }).then((result)=>{
      if(!cancelled) console.info('[offline] set charts cached', result?.cached)
    }).catch(()=>{})
    return ()=>{cancelled=true}
  },[set?.id, set?.songIds?.join('|'), JSON.stringify(set?.songKeys||{}), songs.map((s)=>s.id).join('|')])
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
    <div className="set-toolbar"><button className="run-button" disabled={!setSongs.length} onClick={() => {
      setRunning(true)
      if(!isProbablyOffline()) prefetchSetCharts(set, setSongs, { apiFetch, apiUrl }).catch(()=>{})
    }}><Play size={19}/>{t('sets.start')}</button><span>{t('sets.autoSave')}</span>{!set.isProtected&&<button className="delete-set-button" onClick={async () => { if (!window.confirm(t('sets.confirmDelete', { title: set.title }))) return; await deleteSet(set.id); updateSets((current) => current.filter((item) => item.id !== set.id)); navigate('/sets') }}><Trash2 size={17}/>{t('sets.delete')}</button>}</div>
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
  const [autoScroll, setAutoScroll] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [bpmInput, setBpmInput] = useState('120')
  const [cajonOn, setCajonOn] = useState(false)
  const [lyricsOnly, setLyricsOnly] = useState(()=>{try{const s=localStorage.getItem('songbook-lyrics-only');return s==='1'||s==='true'}catch{return false}})
  const touchStart = useRef(null)
  const stageScrollRef = useRef(null)
  const song = songs[index]
  const selectedKey = set.songKeys?.[song.id] || ''
  const showingEditedChart = Boolean(selectedKey)
  const previous = () => setIndex((current) => Math.max(0, current - 1))
  const next = () => setIndex((current) => Math.min(songs.length - 1, current + 1))
  useEffect(() => {
    const handleKey = (event) => {
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); setIndex((current) => Math.min(songs.length - 1, current + 1)) }
      if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)) }
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [songs.length, onClose])
  useEffect(() => {
    const pane = stageScrollRef.current
    if (pane) pane.scrollTop = 0
  }, [index, song.id, selectedKey])
  useEffect(() => {
    let active = true
    const fromMeta = clampTempoBpm(song?.bpm, { fallback: null })
    if (fromMeta != null) {
      setBpm(fromMeta)
      setBpmInput(String(fromMeta))
    }
    ;(async () => {
      try {
        const data = await getSongOriginalSnapshot(song.id)
        if (!active) return
        const original = resolveEditorSnapshot(data)
        if (!original.ok) {
          if (fromMeta == null) { setBpm(120); setBpmInput('120') }
          return
        }
        let text = original.originalText
        if (selectedKey) {
          const variants = await getSongVariants(song.id)
          if (!active) return
          const current = variants.find((variant) => normalizeEditorKey(variant.targetKey) === normalizeEditorKey(selectedKey))
          if (typeof current?.overlayText === 'string' && current.overlayText) text = current.overlayText
        }
        const tempo = parseTempoBpm(text) || parseTempoBpm(original.originalText) || fromMeta
        if (!active) return
        const nextBpm = tempo || 120
        setBpm(nextBpm)
        setBpmInput(String(nextBpm))
      } catch {
        if (active && fromMeta == null) { setBpm(120); setBpmInput('120') }
      }
    })()
    return () => { active = false }
  }, [song.id, song.bpm, selectedKey])
  useEffect(() => {
    if (!autoScroll) return
    const timer = window.setInterval(() => {
      const pane = stageScrollRef.current
      if (!pane) return
      const frame = pane.querySelector('iframe.stage-fill, embed.stage-fill')
      if (frame) {
        try {
          const win = frame.contentWindow
          if (win) {
            win.scrollBy(0, 1)
            return
          }
        } catch {
          /* cross-origin / PDF plugin — fall through to pane scroll */
        }
      }
      pane.scrollBy({ top: 1, behavior: 'auto' })
    }, 70)
    return () => window.clearInterval(timer)
  }, [autoScroll])
  useCajon(cajonOn, bpm)
  const finishSwipe = (clientX, clientY) => {
    if (touchStart.current === null) return
    const start = touchStart.current
    const dx = clientX - (typeof start === 'number' ? start : start.x)
    const dy = typeof start === 'number' ? 0 : clientY - start.y
    // Horizontal song change only — ignore mostly-vertical chart scrolls.
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      if (dx < 0) next()
      if (dx > 0) previous()
    }
    touchStart.current = null
  }
  const onStageTouchStart = (event) => {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }
  const onStageTouchEnd = (event) => {
    const touch = event.changedTouches[0]
    finishSwipe(touch.clientX, touch.clientY)
  }
  return <div className="run-mode"><header><div className="run-meta"><p className="eyebrow">{t('sets.runMode')}</p><strong>{set.title}</strong><span>{index + 1}/{songs.length} · {song.title}{selectedKey?` · ${t('home.key', { key: selectedKey })}`:''}</span></div><div className="run-tools"><div className="tool-group scroll-tool"><span>{t('songs.autoScroll')}</span><button type="button" className={autoScroll?'active':''} onClick={()=>setAutoScroll((value)=>!value)} aria-pressed={autoScroll}>{autoScroll?<Pause size={18}/>:<Play size={18}/>}</button></div><div className={`tool-group lyrics-only-tool run-lyrics-tool${showingEditedChart?'':' tool-disabled'}`}><span>{t('songs.lyricsView')}</span><button type="button" disabled={!showingEditedChart} className={lyricsOnly?'active':''} onClick={()=>{const next=!lyricsOnly;setLyricsOnly(next);try{localStorage.setItem('songbook-lyrics-only', next?'1':'0')}catch{}}} title={t('songs.lyricsViewHint')} aria-pressed={lyricsOnly}>{lyricsOnly?t('songs.lyricsOnlyOn'):t('songs.lyricsOnlyOff')}</button></div><div className="tool-group cajon-tool"><span>{t('songs.cajon')}</span><input aria-label={t('songs.tempoAria')} type="number" min="40" max="240" inputMode="numeric" value={bpmInput} onChange={(event)=>{const raw=event.target.value;setBpmInput(raw);if(raw==='')return;const n=Number(raw);if(Number.isFinite(n))setBpm(n)}} onBlur={()=>{const nextTempo=clampTempoBpm(bpmInput,{fallback:bpm});if(nextTempo==null){setBpmInput(String(bpm));return}setBpm(nextTempo);setBpmInput(String(nextTempo))}}/><button type="button" className={cajonOn?'active':''} onClick={async ()=>{if(cajonOn){setCajonOn(false);return}playCajonHtmlHit({strong:true});await unlockCajonAudio();await preloadCajonSample();playCajonHit({strong:true});setCajonOn(true)}} title={t('songs.startCajon')} aria-pressed={cajonOn}>{cajonOn?<Pause size={18}/>:<Play size={18}/>}</button></div><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X size={22}/></button></div></header>
    <main className="pdf-stage">
      <div className="pdf-stage-scroll" ref={stageScrollRef} onTouchStart={onStageTouchStart} onTouchEnd={onStageTouchEnd}>
        {showingEditedChart ? <AuthorizedFrame key={`${song.id}-${selectedKey}-${lyricsOnly?'ly':'ch'}-${bpm}`} title={`${song.title} – ${selectedKey}`} path={songChartUrl(song,selectedKey,{lyricsOnly,bpm})} fitContent className="stage-fit-content"/> : hasSongPdf(song) ? <AuthorizedFrame key={song.id} title={song.title} path={songPdfUrl(song)} hash="#toolbar=0&navpanes=0&view=FitH" className="stage-fill" songId={song.id} preferPageImages/> : <div className="no-pdf"><FileText size={42}/><strong>{song.title}</strong><span>{t('sets.noPdf')}</span></div>}
      </div>
      {!showingEditedChart && hasSongPdf(song) ? <><div className="stage-swipe-strip left" aria-hidden="true" onTouchStart={onStageTouchStart} onTouchEnd={onStageTouchEnd}/><div className="stage-swipe-strip right" aria-hidden="true" onTouchStart={onStageTouchStart} onTouchEnd={onStageTouchEnd}/></> : null}
      <button className="stage-arrow left" disabled={index === 0} onClick={previous} aria-label={t('sets.prevSong')}><ChevronLeft size={32}/></button><button className="stage-arrow right" disabled={index === songs.length - 1} onClick={next} aria-label={t('sets.nextSong')}><ChevronRight size={32}/></button>
    </main><footer><button disabled={index === 0} onClick={previous}><ChevronLeft size={21}/>{t('common.back')}</button><div>{songs.map((item, itemIndex) => <span className={itemIndex === index ? 'active' : ''} key={`${item.id}-${itemIndex}`}/>)}</div><button disabled={index === songs.length - 1} onClick={next}>{t('common.next')}<ChevronRight size={21}/></button></footer></div>
}

function EditSongDialog({song, onClose, onSave}) {
  const { t } = useI18n()
  const close=()=>dismissModal(onClose)
  const avoidAutoFocus=useAvoidMobileAutoFocus()
  const [title, setTitle] = useState(song.title)
  const [key, setKey] = useState(song.key === '–' ? '' : song.key || '')
  const [saving, setSaving] = useState(false)
  return <ModalBackdrop onClose={onClose}><section className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{t('songs.editTitle')}</p><h2>{t('songs.editHint')}</h2></div><button className="icon-button" onClick={close}><X size={20}/></button></div>
    <label className="field"><span>{t('songs.songTitle')}</span><div><FileText size={18}/><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!avoidAutoFocus}/></div></label>
    <label className="field"><span>{t('songs.key')}</span><div><Music2 size={18}/><input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('songs.keyPlaceholder')}/></div></label>
    <div className="modal-actions"><button className="cancel-button" onClick={close} disabled={saving}>{t('common.cancel')}</button><button className="add-button compact" disabled={!title.trim() || saving} onClick={async () => { setSaving(true); try { await onSave({title: title.trim(), artist: song.artist, key: key.trim() || '–'}) } finally { setSaving(false) } }}><CheckCircle2 size={18}/>{saving ? t('common.saving') : t('songs.saveChanges')}</button></div>
  </section></ModalBackdrop>
}

function SongEditorRoute({songs,setSongs,navigate}) {
  const { t } = useI18n()
  const {songId}=useParams();const song=songs.find((item)=>item.id===songId)
  if(!song)return <SimplePage eyebrow={t('songs.editor')} title={t('songs.notFound')} text={t('songs.notInLibrary')}/>
  return <TransposeDialog embedded song={song} onClose={()=>navigate('/songs')} onKeysResolved={(keys)=>setSongs((current)=>current.map((item)=>item.id===song.id?{...item,...keys}:item))} onSave={async(values)=>{const variant=await saveSongVariant(song.id,values);setSongs((current)=>current.map((item)=>item.id===song.id?{...item,key:variant.targetKey,sourceKey:variant.sourceKey,originalKey:variant.sourceKey,preferredKey:variant.targetKey,sheetColumns:variant.sheetColumns??values.sheetColumns??item.sheetColumns,sheetFontSize:variant.sheetFontSize??values.sheetFontSize??item.sheetFontSize,variantKeys:Array.from(new Set([variant.targetKey,...(item.variantKeys||[])]))}:item));return variant}}/>
}


function serializeChartSheetDom(root) {
  if (!root) return ''
  const parts = []
  for (const child of Array.from(root.children || [])) {
    const cls = child.classList || { contains: () => false }
    if (cls.contains('chart-blank')) {
      if (parts.length && parts[parts.length - 1] !== '') parts.push('')
      continue
    }
    if (cls.contains('chart-section')) {
      const label = String(child.innerText || '').trim().replace(/^\[|\]$/g, '')
      parts.push(`[${label}]`)
      continue
    }
    if (cls.contains('chart-meta')) {
      parts.push(String(child.innerText || '').replace(/\s+$/g, ''))
      continue
    }
    if (cls.contains('chart-pair')) {
      const stacks = Array.from(child.querySelectorAll('.chart-stack')).map((el) => {
        const chordEl = el.querySelector('.chart-stack-chord')
        const visible = String(chordEl?.innerText || '').replace(/\u00a0/g, ' ').trim()
        const full = String(chordEl?.getAttribute('data-full') || '').trim()
        const chord = full && simplifyChordToken(full) === visible ? full : visible
        const word = String(el.querySelector('.chart-stack-word')?.innerText || '').replace(/\u00a0/g, ' ').trim()
        return { chord, word }
      })
      const packed = wordStacksToChordLyric(stacks)
      if (packed.chordLine.trim()) parts.push(packed.chordLine)
      parts.push(packed.lyricLine)
      continue
    }
    if (cls.contains('chart-chords')) {
      const full = String(child.getAttribute('data-full') || '').trim()
      const visible = String(child.innerText || '').replace(/\s+$/g, '')
      parts.push(full && simplifyChordToken(full.replace(/\s+$/g, '')) === visible.replace(/\s+$/g, '') ? full.replace(/\s+$/g, '') : visible)
      continue
    }
    if (cls.contains('chart-lyrics')) {
      parts.push(String(child.innerText || '').replace(/\s+$/g, ''))
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function ChartSheet({ text, columns, fontSize, editable, onCommit, simplifyChords = true, lyricsOnly = false }) {
  const display = softFormatChordChart(text || '')
  // Wrap long pairs so iPad never needs horizontal pan; stacks keep chords on syllables.
  const maxCols = columns === 2 ? 28 : 44
  const blocks = parseChartBlocks(display, { maxCols }).filter((block) => {
    if (block?.kind === 'meta' && isRedundantKeyMeta(block.text)) return false
    if (lyricsOnly && block?.kind === 'chords') return false
    return true
  })
  const showChord = (chord) => {
    const full = String(chord || '')
    if (!simplifyChords) return full || '\u00a0'
    return simplifyChordToken(full) || '\u00a0'
  }
  return (
    <div
      key={`${display}::${simplifyChords ? 'simple' : 'full'}::${lyricsOnly ? 'lyrics' : 'chords'}`}
      className={`chart-sheet columns-${columns}${lyricsOnly ? ' lyrics-only' : ''}`}
      style={{ fontSize }}
      contentEditable={editable && !lyricsOnly}
      suppressContentEditableWarning
      spellCheck="false"
      onBlur={(event) => {
        if (!editable || lyricsOnly || !onCommit) return
        const shown = normalizeChartInnerText(serializeChartSheetDom(event.currentTarget))
        if (shown === normalizeChartInnerText(display)) return
        onCommit(shown)
      }}
    >
      {blocks.map((block, index) => {
        if (block.kind === 'blank') return <div key={index} className="chart-blank">&nbsp;</div>
        if (block.kind === 'section') {
          const label = formatSectionLabel(block.text)
          return <div key={index} className="chart-section">{label}</div>
        }
        if (block.kind === 'meta') return <div key={index} className="chart-meta">{block.text}</div>
        if (block.kind === 'pair') {
          return (
            <div key={index} className="chart-pair">
              {(block.stacks || []).map((stack, stackIndex) => {
                const shown = showChord(stack.chord)
                const hasChord = Boolean(String(stack.chord || '').trim()) && !lyricsOnly
                return (
                  <span key={stackIndex} className="chart-stack">
                    <span
                      className={hasChord ? 'chart-stack-chord chart-chord-pill' : 'chart-stack-chord'}
                      data-full={stack.chord || ''}
                    >{lyricsOnly ? '' : shown}</span>
                    <span className="chart-stack-word">{stack.word || '\u00a0'}</span>
                  </span>
                )
              })}
            </div>
          )
        }
        if (block.kind === 'chords') {
          const full = String(block.text || '')
          const shown = simplifyChords
            ? full.replace(/(Cis|Des|Dis|Es(?!us)|Fis|Ges|Gis|As(?!us)|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])((?:m|maj|min|dim|aug|sus|add)?\d*(?:sus\d*)?(?:[#b+°\-]\d*)*(?:\/(?:Cis|Des|Dis|Es(?!us)|Fis|Ges|Gis|As(?!us)|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH]))?)/gu, (all) => simplifyChordToken(all))
            : full
          return <div key={index} className="chart-chords" data-full={full}>{shown}</div>
        }
        return <div key={index} className="chart-lyrics">{block.text}</div>
      })}
    </div>
  )
}

function readSimplifyChordsPref(locale = 'de') {
  try {
    const stored = localStorage.getItem('songbook-simplify-chords')
    if (stored === '0' || stored === 'false') return false
    if (stored === '1' || stored === 'true') return true
  } catch {}
  return locale !== 'en' // DE (and default) → simplified chords ON
}

function TransposeDialog({song,onClose,onSave,onKeysResolved,embedded=false,homeEmbedded=false}) {
  const { t, locale } = useI18n()
  const [originalText,setOriginalText]=useState('');const [overlayText,setOverlayText]=useState('');const [sourceKey,setSourceKey]=useState('');const [targetKey,setTargetKey]=useState('');const [snapshotVerified,setSnapshotVerified]=useState(false);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [saved,setSaved]=useState('');const [needsReview,setNeedsReview]=useState(false);const [reanalyzing,setReanalyzing]=useState(false);const [reloadToken,setReloadToken]=useState(0);const [fontSize,setFontSize]=useState(()=>Math.min(28,Math.max(11,Number(song.sheetFontSize)||16)));const [columns,setColumns]=useState(()=>Number(song.sheetColumns)===2?2:1);const [autoScroll,setAutoScroll]=useState(false);const [bpm,setBpm]=useState(120);const [bpmInput,setBpmInput]=useState('120');const [cajonOn,setCajonOn]=useState(false);const [view,setView]=useState(hasSongPdf(song)?'original':'edited');const [simplifyChords,setSimplifyChords]=useState(()=>readSimplifyChordsPref(locale));const [lyricsOnly,setLyricsOnly]=useState(()=>{try{const s=localStorage.getItem('songbook-lyrics-only');return s==='1'||s==='true'}catch{return false}});const [youtubeUrl,setYoutubeUrl]=useState(song.youtubeUrl||'');const [youtubeResolving,setYoutubeResolving]=useState(false);const [tunerOpen,setTunerOpen]=useState(false)
  const setSimplifyPref=(next)=>{setSimplifyChords(next);try{localStorage.setItem('songbook-simplify-chords', next?'1':'0')}catch{}}
  const setLyricsOnlyPref=(next)=>{setLyricsOnly(next);try{localStorage.setItem('songbook-lyrics-only', next?'1':'0')}catch{}}
  useEffect(()=>{
    setYoutubeUrl(song.youtubeUrl||'')
  },[song.id,song.youtubeUrl])
  useEffect(()=>{
    if(!song?.id || youtubeUrl) return
    let cancelled=false
    ;(async()=>{
      try{
        setYoutubeResolving(true)
        const resolved=await resolveSongYoutube(song.id)
        if(cancelled)return
        if(resolved?.youtubeUrl){
          setYoutubeUrl(resolved.youtubeUrl)
          onKeysResolved?.({youtubeUrl:resolved.youtubeUrl,youtubeVideoId:resolved.youtubeVideoId||'',youtubeSource:resolved.youtubeSource||''})
        }
      }catch(error){
        console.warn('youtube resolve failed', song.id, error)
        if(!cancelled){
          const q=[song.title, song.artist && !/pdf-import|import|gescannt|text-import/i.test(song.artist)?song.artist:''].filter(Boolean).join(' ')
          setYoutubeUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(q||song.title||'worship')}`)
        }
      }finally{
        if(!cancelled)setYoutubeResolving(false)
      }
    })()
    return()=>{cancelled=true}
  },[song.id,youtubeUrl])
  const openYoutubeRehearsal=()=>{
    const url=youtubeUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(song.title||'')}`
    openExternal(url)
  }
  const projection=projectEditorSnapshot({originalText,overlayText,sourceKey,selectedKey:targetKey});const text=projection.text
  useEffect(()=>{let active=true;(async()=>{try{setLoading(true);setError('');let data=await getSongOriginalSnapshot(song.id);if(!active)return;let original=resolveEditorSnapshot(data);if(!original.ok && hasSongPdf(song)){try{setReanalyzing(true);await analyzeSongChords(song.id);if(!active)return;data=await getSongOriginalSnapshot(song.id);original=resolveEditorSnapshot(data)}catch(repairError){if(!active)return;console.warn('song reanalyze failed',repairError)}finally{if(active)setReanalyzing(false)}}if(!original.ok){setOriginalText('');setOverlayText('');setSourceKey('');setTargetKey('');setSnapshotVerified(false);setNeedsReview(true);setLoading(false);return}const variants=await getSongVariants(song.id);if(!active)return;const preferred=normalizeEditorKey(song.preferredKey)||normalizeEditorKey(song.key);const current=variants.find((variant)=>normalizeEditorKey(variant.targetKey)===preferred);const selected=normalizeEditorKey(current?.targetKey)||preferred||original.sourceKey;const overlay=typeof current?.overlayText==='string'&&current.overlayText?current.overlayText:original.originalText;setOriginalText(original.originalText);setOverlayText(overlay);setSourceKey(original.sourceKey);setTargetKey(selected);setSnapshotVerified(true);setNeedsReview(false);onKeysResolved?.({sourceKey:original.sourceKey,originalKey:original.sourceKey,sourceKeyStatus:'verified',sourceKeyVerified:true,snapshotStatus:'verified',snapshotId:original.snapshotId,key:selected,preferredKey:selected});const tempo=parseTempoBpm(overlay)||parseTempoBpm(original.originalText);if(tempo){setBpm(tempo);setBpmInput(String(tempo))}setLoading(false)}catch(caught){if(active){setError(caught.message);setLoading(false)}}})();return()=>{active=false}},[song.id,reloadToken])
  useEffect(()=>{
    setColumns(Number(song.sheetColumns)===2?2:1)
    setFontSize(Math.min(28,Math.max(11,Number(song.sheetFontSize)||16)))
  },[song.id,song.sheetColumns,song.sheetFontSize])
  const persistSheetLayout=async(nextColumns,nextFontSize)=>{
    const sheetColumns=nextColumns??columns
    const sheetFontSize=nextFontSize??fontSize
    try{
      const updated=await updateSong(song.id,{title:song.title,artist:song.artist,key:song.key,sheetColumns,sheetFontSize})
      onKeysResolved?.({sheetColumns:updated.sheetColumns,sheetFontSize:updated.sheetFontSize})
    }catch(error){
      console.warn('sheet layout persist failed', error)
    }
  }
  useEffect(()=>{if(!autoScroll)return;const timer=window.setInterval(()=>window.scrollBy({top:1,behavior:'auto'}),70);return()=>window.clearInterval(timer)},[autoScroll])
  useCajon(cajonOn, bpm)
  const close=()=>embedded?onClose():dismissModal(onClose)
  useEffect(()=>{
    if(embedded)return
    lockBodyScroll()
    return ()=>unlockBodyScroll()
  },[embedded])
  const changeTargetKey=(next)=>{const applied=applyEditorKeyChange(overlayText,sourceKey,next);if(!applied.blocked)setTargetKey(applied.targetKey)}
  const saveEditor=async()=>{
    setSaving(true);setSaved('')
    try{
      const knownSource=normalizeEditorKey(sourceKey)
      const knownTarget=normalizeEditorKey(targetKey)||knownSource
      if(!snapshotVerified||!knownSource||!knownTarget)throw new Error(t('songs.snapshotReviewRequired'))
      const variant=await onSave({overlayText,targetKey:knownTarget,sheetColumns:columns,sheetFontSize:fontSize})
      if(variant?.sheetColumns!=null||variant?.sheetFontSize!=null){
        onKeysResolved?.({sheetColumns:variant.sheetColumns??columns,sheetFontSize:variant.sheetFontSize??fontSize})
      }
      setSaved(t('songs.savedInKey', { key: knownTarget }))
    }finally{setSaving(false)}
  }
  const originalUrl=songPdfUrl(song);const share=async()=>{const data=view==='original'?{title:song.title,url:new URL(originalUrl,window.location.origin).href}:{title:song.title,text:`${song.title}\n\n${text}`};if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url||data.text);setSaved(t('songs.copiedClipboard'))}}
  const download=async()=>{const link=document.createElement('a');if(view==='original'){try{const href=await authorizedObjectUrl(originalUrl);link.href=href;link.download=song.fileName||`${song.title}.pdf`;link.click();if(href.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(href),30000)}catch{link.href=originalUrl;link.download=song.fileName||`${song.title}.pdf`;link.click()}}else{link.href=URL.createObjectURL(new Blob([`${song.title}\n\n${text}`],{type:'text/plain;charset=utf-8'}));link.download=`${song.title}.txt`;link.click();URL.revokeObjectURL(link.href)}}
  const printSheet=async()=>{if(view==='original'){try{const href=await authorizedObjectUrl(originalUrl);window.open(`${href}#toolbar=1`,'_blank','noopener')}catch{window.open(`${originalUrl}#toolbar=1`,'_blank','noopener')}}else window.print()}
  return <div className={`${embedded?'song-editor-page':'modal-backdrop'}${homeEmbedded?' home-song-editor':''}`} onMouseDown={(event)=>!embedded&&event.target===event.currentTarget&&close()}>{embedded&&<button className="back-button editor-back" onClick={close}><ChevronLeft size={18}/>{t('songs.toLibrary')}</button>}<section className={embedded?'song-editor-surface':'modal modal-wide transpose-modal'}>{loading?<div className="analysis-loading"><Music2 size={30}/><strong>{t('songs.preparing')}</strong></div>:error?<div className="form-error analysis-error">{error}</div>:<><div className="editor-view-switch"><button className={view==='original'?'active':''} onClick={()=>setView('original')} disabled={!hasSongPdf(song)}>{t('songs.originalPdf')}</button><button className={view==='edited'?'active':''} onClick={()=>setView('edited')}>{t('songs.editKey')}</button><button type="button" className="youtube-rehearsal" onClick={openYoutubeRehearsal} disabled={youtubeResolving&&!youtubeUrl} title={t('songs.youtubeRehearsalHint')}>{youtubeResolving&&!youtubeUrl?t('songs.youtubeResolving'):t('songs.youtubeRehearsal')}</button><button type="button" className="guitar-tuner-btn" onClick={()=>setTunerOpen(true)} title={t('songs.tunerHint')}>{t('songs.tuner')}</button><span>{view==='original'?t('songs.originalHint'):t('songs.editableHint')}</span></div>{needsReview&&view==='edited'&&<div className="analysis-quality-warn" role="status"><p>{t('songs.snapshotReviewRequired')}</p>{hasSongPdf(song)?<button className="add-button compact" disabled={reanalyzing} onClick={()=>{setReanalyzing(true);setReloadToken((value)=>value+1)}}>{reanalyzing?t('songs.reanalyzing'):t('songs.reanalyze')}</button>:<p>{t('songs.reuploadHint')}</p>}</div>}<div className="sheet-toolbar"><label className={view==='original'||!snapshotVerified?'tool-disabled':''}><span>{t('songs.changeKey')}</span><select disabled={view==='original'||!snapshotVerified} value={targetKey||'–'} onChange={(event)=>changeTargetKey(event.target.value)}>{!targetKey&&<option value="–">–</option>}{GERMAN_EDITOR_KEYS.map((key)=><option key={key} value={key}>{displayEditorKeyLabel(key)}</option>)}</select></label><div className={`tool-group simplify-tool${view==='original'||!snapshotVerified||lyricsOnly?' tool-disabled':''}`}><span>{t('songs.simplifyChords')}</span><button disabled={view==='original'||!snapshotVerified||lyricsOnly} className={simplifyChords?'active':''} onClick={()=>setSimplifyPref(!simplifyChords)} title={t('songs.simplifyChordsHint')}>{simplifyChords?t('songs.simplifyOn'):t('songs.simplifyOff')}</button></div><div className={`tool-group lyrics-only-tool${view==='original'||!snapshotVerified?' tool-disabled':''}`}><span>{t('songs.lyricsView')}</span><button disabled={view==='original'||!snapshotVerified} className={lyricsOnly?'active':''} onClick={()=>setLyricsOnlyPref(!lyricsOnly)} title={t('songs.lyricsViewHint')}>{lyricsOnly?t('songs.lyricsOnlyOn'):t('songs.lyricsOnlyOff')}</button></div><div className={`columns-font-cluster${view==='original'?' tool-disabled':''}`}><div className={`tool-group${view==='original'?' tool-disabled':''}`}><span>{t('songs.columns')}</span><button disabled={view==='original'} className={columns===1?'active':''} onClick={()=>{setColumns(1);persistSheetLayout(1,fontSize)}}>1</button><button disabled={view==='original'} className={columns===2?'active':''} onClick={()=>{setColumns(2);persistSheetLayout(2,fontSize)}}><Columns2 size={16}/></button></div><div className={`tool-group font-tools${view==='original'?' tool-disabled':''}`}><span>{t('songs.font')}</span><button disabled={view==='original'} onClick={()=>{setFontSize((size)=>{const next=Math.max(11,size-1);persistSheetLayout(columns,next);return next})}}>−</button><Type size={18}/><button disabled={view==='original'} onClick={()=>{setFontSize((size)=>{const next=Math.min(28,size+1);persistSheetLayout(columns,next);return next})}}>+</button><button disabled={view==='original'} onClick={()=>{setFontSize(16);persistSheetLayout(columns,16)}} title={t('songs.resetFont')}><RotateCcw size={15}/></button></div></div><div className="tool-group scroll-tool"><span>{t('songs.autoScroll')}</span><button className={autoScroll?'active':''} onClick={()=>setAutoScroll((value)=>!value)}>{autoScroll?<Pause size={18}/>:<Play size={18}/>}</button></div><div className="tool-group cajon-tool"><span>{t('songs.cajon')}</span><input aria-label={t('songs.tempoAria')} type="number" min="40" max="240" inputMode="numeric" value={bpmInput} onChange={(event)=>{const raw=event.target.value;setBpmInput(raw);if(raw==='')return;const n=Number(raw);if(Number.isFinite(n))setBpm(n)}} onBlur={()=>{const next=clampTempoBpm(bpmInput,{fallback:bpm});if(next==null){setBpmInput(String(bpm));return}setBpm(next);setBpmInput(String(next))}}/><button className={cajonOn?'active':''} onClick={async ()=>{if(cajonOn){setCajonOn(false);return}playCajonHtmlHit({strong:true});await unlockCajonAudio();await preloadCajonSample();playCajonHit({strong:true});setCajonOn(true)}} title={t('songs.startCajon')}>{cajonOn?<Pause size={18}/>:<Play size={18}/>}</button></div><div className="tool-group sheet-actions"><span>{t('songs.sheet')}</span><button onClick={printSheet} title={t('songs.print')}><Printer size={18}/></button><button onClick={download} title={t('songs.download')}><Download size={18}/></button><button onClick={share} title={t('songs.share')}><Share2 size={18}/></button><button onClick={()=>document.documentElement.requestFullscreen?.()} title={t('songs.fullscreen')}><Maximize2 size={18}/></button></div></div>{view==='original'?<div className="original-pdf-sheet"><AuthorizedFrame title={`${song.title} – ${t('songs.originalPdf')}`} path={originalUrl} hash="#toolbar=0&navpanes=0&view=FitH" songId={song.id} preferPageImages/></div>:<><article className="editor-paper"><header><div><h2>{song.title}</h2>{song.artist?<p>{song.artist}</p>:null}<p className="chart-header-meta">{[targetKey?`Tonart ${displayEditorKeyLabel(targetKey)}`:null, bpm?`${bpm} BPM`:null].filter(Boolean).join(' · ')||'–'}</p></div><Music2 size={30}/></header><ChartSheet text={text} columns={columns} fontSize={fontSize} editable={snapshotVerified} simplifyChords={simplifyChords} lyricsOnly={lyricsOnly} onCommit={(shown)=>{const knownSource=normalizeEditorKey(sourceKey);const knownTarget=normalizeEditorKey(targetKey);setOverlayText(knownSource&&knownTarget?transposeEditorText(shown,knownTarget,knownSource):shown);setSaved('')}}/></article><div className="editor-bottom-actions">{saved&&<span className="editor-saved"><CheckCircle2 size={16}/>{saved}</span>}<button className="add-button compact" disabled={!snapshotVerified||!text.trim()||saving} onClick={saveEditor}><CheckCircle2 size={18}/>{saving?t('common.saving'):t('songs.saveEdited', { key: targetKey||'–' })}</button></div></>}</>}</section>{tunerOpen&&<GuitarTunerModal onClose={()=>setTunerOpen(false)}/>}</div>
}

function ScanDialog({onClose,onSave}) {
  const { t } = useI18n()
  const close=()=>dismissModal(onClose)
  const avoidAutoFocus=useAvoidMobileAutoFocus()
  const cameraRef=useRef(null)
  const galleryRef=useRef(null)
  const fileRef=useRef(null)
  const [title,setTitle]=useState('')
  const [pages,setPages]=useState([])
  const [pdfFile,setPdfFile]=useState(null)
  const [pdfPages,setPdfPages]=useState([])
  const [selectedPdfPages,setSelectedPdfPages]=useState([])
  const [pasteText,setPasteText]=useState('')
  const [mode,setMode]=useState('images') // images | pdf | text
  const [saving,setSaving]=useState(false)
  const [previewing,setPreviewing]=useState(false)
  const [error,setError]=useState('')
  const [nativeScanner,setNativeScanner]=useState(false)
  const [scanningNative,setScanningNative]=useState(false)

  useEffect(()=>{let alive=true;import('./documentScanner').then(m=>m.isNativeDocumentScannerAvailable()).then(ok=>{if(alive)setNativeScanner(ok)}).catch(()=>{});return()=>{alive=false}},[])
  useEffect(()=>()=>{pages.forEach((page)=>URL.revokeObjectURL(page.url))},[])

  const clearImagePages=()=>setPages((current)=>{current.forEach((page)=>URL.revokeObjectURL(page.url));return []})
  const resetPdf=()=>{setPdfFile(null);setPdfPages([]);setSelectedPdfPages([])}

  // iOS Photos/Files often omit File.type — do not filter on image/* MIME alone.
  const add=(files,{fromGallery=false}={})=>{
    const next=Array.from(files||[]).filter(file=>isLikelyScanImageFile(file,{assumeImage:fromGallery}))
    if(!next.length)return
    setMode('images')
    resetPdf()
    setPasteText('')
    setPages(current=>[...current,...next.slice(0,8-current.length).map(file=>({id:crypto.randomUUID(),file,url:URL.createObjectURL(file)}))])
    setTitle(current=>current.trim()?current:(titleFromScanFile(next[0])||'Scan'))
    setError('')
  }
  const remove=id=>setPages(current=>{const page=current.find(item=>item.id===id);if(page)URL.revokeObjectURL(page.url);return current.filter(item=>item.id!==id)})
  const move=(index,offset)=>setPages(current=>{const target=index+offset;if(target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next})

  const openNativeScanner=async()=>{
    setScanningNative(true);setError('')
    try{
      const { scanDocumentsNative } = await import('./documentScanner')
      const result=await scanDocumentsNative({maxPages:8-pages.length})
      if(result.cancelled)return
      if(result.source==='fallback'){cameraRef.current?.click();return}
      add(result.pages,{fromGallery:true})
    }catch(e){setError(e.message||t('scan.failed'));cameraRef.current?.click()}
    finally{setScanningNative(false)}
  }
  const openPrimaryCapture=()=>{if(nativeScanner)openNativeScanner();else cameraRef.current?.click()}

  const loadPdfPreview=async(file)=>{
    setPreviewing(true);setError('')
    try{
      const preview=await previewScanPdf(file)
      setMode('pdf')
      clearImagePages()
      setPasteText('')
      setPdfFile(file)
      setPdfPages(preview.pages||[])
      const suggested=(preview.suggested?.length?preview.suggested:((preview.pages||[]).length===1?[0]:[])).slice(0,8)
      setSelectedPdfPages(suggested)
      if(!title.trim() && file.name) setTitle(file.name.replace(/\.pdf$/i,''))
    }catch(e){setError(e.message||t('scan.failed'));resetPdf()}
    finally{setPreviewing(false)}
  }

  const onPickFiles=async(fileList)=>{
    const files=Array.from(fileList||[])
    if(!files.length)return
    const file=files[0]
    const kind=classifyScanFile(file,{assumeImage:false})
    if(kind==='pdf'){
      await loadPdfPreview(file)
      return
    }
    if(kind==='text'){
      const text=await file.text()
      setMode('text')
      clearImagePages()
      resetPdf()
      setPasteText(text)
      setTitle(current=>current.trim()?current:titleFromScanFile(file))
      return
    }
    if(kind==='image' || files.some(item=>isLikelyScanImageFile(item,{assumeImage:true}))){
      add(files,{fromGallery:true})
      return
    }
    setError(t('scan.unsupportedFile'))
  }

  const togglePdfPage=(index)=>{
    setSelectedPdfPages((current)=>{
      if(current.includes(index)) return current.filter((value)=>value!==index)
      if(current.length>=8) return current
      return [...current,index].sort((a,b)=>a-b)
    })
  }

  const canSubmit=canSubmitScan({
    title,
    mode,
    pageCount:pages.length,
    hasPdf:Boolean(pdfFile),
    selectedPdfCount:selectedPdfPages.length,
    pasteText,
  })

  const submit=async()=>{
    setSaving(true);setError('')
    try{
      const songTitle=resolveScanTitle(title, mode==='pdf'?pdfFile:pages[0]?.file)
      if(mode==='text') await onSave(songTitle,{text:pasteText})
      else if(mode==='pdf') await onSave(songTitle,{pdfFile,selectedPages:selectedPdfPages})
      else await onSave(songTitle,{pages})
    }catch(e){setError(e.message);setSaving(false)}
  }

  return <ModalBackdrop onClose={onClose}><section className="modal modal-wide scan-modal">
    <div className="modal-header"><div><p className="eyebrow">{t('scan.title')}</p><h2>{t('scan.subtitle')}</h2></div><button className="icon-button" onClick={close}><X size={20}/></button></div>
    <div className="scan-guide"><span>1</span><p><strong>{t('scan.guideSources')}</strong><small>{t('scan.guideSourcesHint')}</small></p></div>
    <input ref={cameraRef} className="file-input" type="file" accept={SCAN_IMAGE_ACCEPT} capture="environment" onChange={event=>{add(event.target.files,{fromGallery:true});event.target.value=''}}/>
    <input ref={galleryRef} className="file-input" type="file" accept={SCAN_IMAGE_ACCEPT} multiple onChange={event=>{add(event.target.files,{fromGallery:true});event.target.value=''}}/>
    <input ref={fileRef} className="file-input" type="file" accept={SCAN_MIXED_ACCEPT} onChange={event=>{onPickFiles(event.target.files);event.target.value=''}}/>
    <div className="scan-actions scan-actions-extended">
      <button type="button" className="scan-camera-button" disabled={scanningNative||pages.length>=8} onClick={openPrimaryCapture}><FileText size={24}/><span><strong>{scanningNative?t('scan.scanning'):(pages.length?t('scan.nextPage'):(nativeScanner?t('scan.openDocumentScanner'):t('scan.openCamera')))}</strong><small>{nativeScanner?t('scan.visionKitHint'):t('scan.upTo8')}</small></span></button>
      <button type="button" className="scan-gallery-button" onClick={()=>galleryRef.current?.click()}><Upload size={21}/>{t('scan.pickImages')}</button>
      <button type="button" className="scan-gallery-button" onClick={()=>fileRef.current?.click()} disabled={previewing}>{previewing?t('scan.previewing'):t('scan.pickFile')}</button>
      <button type="button" className={`scan-gallery-button${mode==='text'?' selected':''}`} onClick={()=>{setMode('text');clearImagePages();resetPdf()}}>{t('scan.pasteText')}</button>
      {nativeScanner&&<button type="button" className="scan-gallery-button" onClick={()=>cameraRef.current?.click()}>{t('scan.fallbackCamera')}</button>}
    </div>

    <label className="field scan-title"><span>{t('scan.songTitle')}</span><div><Music2 size={18}/><input value={title} onChange={event=>setTitle(event.target.value)} placeholder={t('scan.titlePlaceholder')} autoFocus={!avoidAutoFocus}/></div></label>

    {mode==='text'&&<label className="field scan-paste"><span>{t('scan.pasteLabel')}</span><textarea value={pasteText} onChange={(event)=>setPasteText(event.target.value)} rows={12} placeholder={t('scan.pastePlaceholder')}/></label>}

    {mode==='pdf'&&pdfPages.length>0&&<>
      <div className="scan-page-select-head"><strong>{t('scan.selectPages')}</strong><small>{t('scan.selectPagesHint',{count:selectedPdfPages.length})}</small></div>
      <div className="scan-pages scan-pdf-pages">{pdfPages.map((page)=><article key={page.index} className={selectedPdfPages.includes(page.index)?'selected':''}>
        <button type="button" className="scan-page-toggle" onClick={()=>togglePdfPage(page.index)}>
          <img src={page.dataUrl} alt={t('scan.pageAlt',{n:page.pageNumber})}/>
          <span>{t('scan.pageN',{n:page.pageNumber})}{page.suggested?' ★':''}</span>
        </button>
      </article>)}</div>
    </>}

    {mode==='images'&&pages.length>0&&<div className="scan-pages">{pages.map((page,index)=><article key={page.id}><img src={page.url} alt={t('scan.pageAlt', { n: index+1 })}/><span>{t('scan.pageN', { n: index+1 })}</span><div><button disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button><button disabled={index===pages.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button><button onClick={()=>remove(page.id)}><Trash2 size={16}/></button></div></article>)}</div>}

    {error&&<p className="form-error">{error}</p>}
    <div className="scan-processing-note"><CheckCircle2 size={18}/><span><strong>{t('scan.autoProcess')}</strong><small>{t('scan.processHintExtended')}</small></span></div>
    <div className="modal-actions"><button className="cancel-button" onClick={close} disabled={saving}>{t('common.back')}</button><button className="add-button compact" disabled={!canSubmit||saving||previewing} onClick={submit}><Upload size={18}/>{saving?t('scan.processing'):t('scan.create')}</button></div>
  </section></ModalBackdrop>
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
  const close=()=>dismissModal(onClose)
  return <ModalBackdrop onClose={onClose}>
    <section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="modal-header"><div><p className="eyebrow">{t('import.title')}</p><h2 id="import-title">{t('import.subtitle')}</h2></div><button className="icon-button" onClick={close} aria-label={t('common.close')}><X size={20}/></button></div>
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
      <div className="modal-actions"><button className="cancel-button" onClick={close} disabled={saving}>{t('common.cancel')}</button><button className="add-button compact" disabled={!valid || saving} onClick={async () => { setSaving(true); setSaveError(''); setProgress(12); try { const payload = items.map((item) => ({ song: {title: item.title.trim(), artist: t('import.artistDefault'), key: '–', bpm: '–', duration: '–'}, file: item.file })); setProgress(35); await onImport(payload); setProgress(100) } catch (caught) { console.error(caught); setSaveError(caught?.name === 'QuotaExceededError' ? t('import.quota') : t('import.failed', { error: caught?.message || t('import.failedGeneric') })); setSaving(false); setProgress(0) } }}><Upload size={18}/>{saving ? t('import.savingN', { count: items.length }) : t('import.nSongs', { count: items.length || '' })}</button></div>
    </section>
  </ModalBackdrop>
}


export default App

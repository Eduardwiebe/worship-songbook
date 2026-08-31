import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  ImagePlus,
  ListMusic,
  Music2,
  Plus,
  Search,
  Upload,
  FileText,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'

import {
  completeOnboarding,
  saveOnboarding,
} from '../onboardingStore'

import {
  createBand,
  getBands,
  selectBand,
  updateBand,
  uploadBandLogo,
  bandLogoUrl,
  searchBands,
  requestBandJoin,
  getMyJoinRequests,
  joinBandByCode,
  selectPersonal,
} from '../bandStore'

import {
  getTeam,
  memberPhoto,
  saveMember,
} from '../teamStore'

import {
  createSet,
  getSets,
} from '../setStore'

import {
  createAppointment,
  getAppointments,
} from '../scheduleStore'

import {
  saveImportedSongs,
} from '../songStore'

import './onboarding.css'
import { useI18n } from '../i18n'

const appointmentTypeKeys=['rehearsal','planning','soundcheck','other']
const roleOptionKeys=['vocals','acoustic','electric','bass','keys','drums','percussion','brass','strings','sound','lights','org']

function Button({
  children,
  variant='primary',
  type='button',
  disabled=false,
  onClick,
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`onboarding-${variant}`}
    >
      {children}
    </button>
  )
}

function Progress({current,total,label}) {
  const { t } = useI18n()
  const percentage=Math.round((current/total)*100)

  return (
    <>
      <div className="onboarding-topline">
        <span>{label}</span>
        <span>{t('ob.stepOf', { current, total })}</span>
      </div>

      <div className="onboarding-progress">
        <span style={{width:`${percentage}%`}}/>
      </div>
    </>
  )
}

function StepHeader({icon:Icon,eyebrow,title,text}) {
  return (
    <>
      <div className="onboarding-step-icon">
        <Icon size={29}/>
      </div>

      <p className="onboarding-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="onboarding-intro">{text}</p>
    </>
  )
}

function StartChoice({icon:Icon,title,text,onClick}) {
  return (
    <button className="onboarding-choice" onClick={onClick}>
      <span><Icon size={24}/></span>

      <div>
        <strong>{title}</strong>
        <small>{text}</small>
      </div>

      <ArrowRight size={19}/>
    </button>
  )
}

export default function Onboarding({state,onState}) {
  const { t } = useI18n()
  const step=Number(state?.step)||0
  const mode=state?.mode||''
  const roleOptions = roleOptionKeys.map((key) => t(`team.role.${key}`))
  const appointmentTypes = Object.fromEntries(appointmentTypeKeys.map((key) => [key, t(`appointments.types.${key}`)]))

  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')

  const [bands,setBands]=useState([])
  const [team,setTeam]=useState([])
  const [sets,setSets]=useState([])

  const [bandName,setBandName]=useState('')
  const [bandDescription,setBandDescription]=useState('')
  const [bandLogo,setBandLogo]=useState(null)
  const [bandLogoPreview,setBandLogoPreview]=useState('')

  const [memberName,setMemberName]=useState('')
  const [memberRoles,setMemberRoles]=useState([])
  const [memberPhotoFile,setMemberPhotoFile]=useState(null)
  const [memberPhotoPreview,setMemberPhotoPreview]=useState('')
  const [isLeader,setIsLeader]=useState(false)
  const [isOrganizer,setIsOrganizer]=useState(false)
  const [isDesigner,setIsDesigner]=useState(false)
  const [isTechnician,setIsTechnician]=useState(false)

  const [setTitle,setSetTitle]=useState('')
  const [setDate,setSetDate]=useState('')

  const [appointments,setAppointments]=useState([])
  const [appointmentType,setAppointmentType]=useState('rehearsal')
  const [appointmentTitle,setAppointmentTitle]=useState('')
  const [appointmentDate,setAppointmentDate]=useState('')
  const [appointmentTime,setAppointmentTime]=useState('19:30')
  const [appointmentLocation,setAppointmentLocation]=useState('')
  const [appointmentNotes,setAppointmentNotes]=useState('')

  const [pdfItems,setPdfItems]=useState([])

  const [bandSearch,setBandSearch]=useState('')
  const [bandResults,setBandResults]=useState([])
  const [,setJoinRequests]=useState([])
  const [inviteCode,setInviteCode]=useState('')

  useEffect(()=>{
    setAppointmentTitle(current=>current||t('appointments.types.rehearsal'))
  },[t])

  useEffect(()=>{
    Promise.all([
      getBands().catch(()=>[]),
      getTeam().catch(()=>[]),
      getSets().catch(()=>[]),
      getAppointments().catch(()=>[]),
    ]).then(([bandRows,teamRows,setRows,appointmentRows])=>{
      setBands(bandRows)
      setTeam(teamRows)
      setSets(setRows)
      setAppointments(appointmentRows)

      const active=bandRows.find(item=>item.active)

      if(active){
        setBandName(active.name||'')
        setBandDescription(active.description||'')

        if(active.hasLogo)
          setBandLogoPreview(`${bandLogoUrl(active)}?v=${Date.now()}`)
      }
    })
  },[])

  const activeBand=useMemo(
    ()=>bands.find(item=>item.active),
    [bands]
  )

  const persist=async values=>{
    const saved=await saveOnboarding({
      ...state,
      ...values,
      completed:state?.manualRestart?true:false,
      manualRestart:Boolean(state?.manualRestart),
    })

    onState(saved)
    return saved
  }

  const back=async()=>{
    setError('')

    if(step===0)return

    if(step===1){
      await persist({step:0})
      return
    }

    if(step===2){
      await persist({
        step:1,
        mode:'',
      })
      return
    }

    await persist({
      step:Math.max(1,step-1),
    })
  }

  const chooseMode=async nextMode=>{
    setError('')

    if(nextMode==='personal')
      await selectPersonal()

    await persist({
      step:2,
      mode:nextMode,
      data:{
        ...(state?.data||{}),
      },
    })
  }

  const saveBand=async event=>{
    event.preventDefault()

    if(bandName.trim().length<2){
      setError(t('ob.err.bandName'))
      return
    }

    setBusy(true)
    setError('')

    try{
      let band

      if(activeBand){
        band=await updateBand(activeBand.id,{
          name:bandName.trim(),
          description:bandDescription.trim(),
        })
      }else{
        band=await createBand({
          name:bandName.trim(),
          description:bandDescription.trim(),
        })

        await selectBand(band.id)
      }

      if(bandLogo)
        await uploadBandLogo(band.id,bandLogo)

      const refreshed=await getBands()
      setBands(refreshed)

      await persist({
        step:3,
        mode:'create',
        data:{
          ...(state?.data||{}),
          bandId:band.id,
        },
      })
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const chooseBandLogo=event=>{
    const file=event.target.files?.[0]
    event.target.value=''

    if(!file)return

    if(bandLogoPreview.startsWith('blob:'))
      URL.revokeObjectURL(bandLogoPreview)

    setBandLogo(file)
    setBandLogoPreview(URL.createObjectURL(file))
  }

  const toggleRole=role=>{
    setMemberRoles(current=>
      current.includes(role)
        ? current.filter(item=>item!==role)
        : [...current,role]
    )
  }

  const chooseMemberPhoto=event=>{
    const file=event.target.files?.[0]
    event.target.value=''

    if(!file)return

    if(memberPhotoPreview.startsWith('blob:'))
      URL.revokeObjectURL(memberPhotoPreview)

    setMemberPhotoFile(file)
    setMemberPhotoPreview(URL.createObjectURL(file))
  }

  const resetMemberForm=()=>{
    if(memberPhotoPreview.startsWith('blob:'))
      URL.revokeObjectURL(memberPhotoPreview)

    setMemberName('')
    setMemberRoles([])
    setMemberPhotoFile(null)
    setMemberPhotoPreview('')
    setIsLeader(false)
    setIsOrganizer(false)
    setIsDesigner(false)
    setIsTechnician(false)
  }

  const addMember=async event=>{
    event.preventDefault()

    if(memberName.trim().length<2){
      setError(t('ob.err.memberName'))
      return
    }

    setBusy(true)
    setError('')

    try{
      const member=await saveMember({
        name:memberName.trim(),
        roles:memberRoles,
        photo:memberPhotoFile,
        isLeader,
        isOrganizer,
        isDesigner,
        isTechnician,
      })

      setTeam(current=>
        [...current,member].sort(
          (a,b)=>a.name.localeCompare(b.name,'de')
        )
      )

      resetMemberForm()
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const finishTeam=async()=>{
    setError('')

    await persist({
      step:4,
      mode:'create',
      data:{
        ...(state?.data||{}),
        teamConfigured:true,
      },
    })
  }

  const saveFirstSet=async event=>{
    event.preventDefault()

    if(!setTitle.trim()){
      setError(t('ob.err.setName'))
      return
    }

    setBusy(true)
    setError('')

    try{
      const created=await createSet({
        title:setTitle.trim(),
        date:setDate,
      })

      setSets(current=>[created,...current])

      await persist({
        step:5,
        data:{
          ...(state?.data||{}),
          firstSetId:created.id,
        },
      })
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const skipSet=async()=>{
    setError('')
    await persist({step:5})
  }

  const activeSet=sets.find(
    item=>item.id===state?.data?.firstSetId
  ) || sets[0]

  const saveAppointment=async event=>{
    event.preventDefault()

    if(!activeSet){
      setError(t('ob.err.needSet'))
      return
    }

    if(!appointmentTitle.trim()||!appointmentDate){
      setError(t('ob.err.appointment'))
      return
    }

    setBusy(true)
    setError('')

    try{
      const created=await createAppointment({
        setId:activeSet.id,
        type:appointmentType,
        title:appointmentTitle.trim(),
        date:appointmentDate,
        time:appointmentTime,
        location:appointmentLocation.trim(),
        notes:appointmentNotes.trim(),
      })

      setAppointments(current=>
        [...current,created].sort(
          (a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
        )
      )

      setAppointmentType('rehearsal')
      setAppointmentTitle(t('appointments.types.rehearsal'))
      setAppointmentDate('')
      setAppointmentTime('19:30')
      setAppointmentNotes('')
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const continueAfterAppointments=async()=>{
    await persist({
      step:6,
      data:{
        ...(state?.data||{}),
        appointmentsConfigured:true,
      },
    })
  }

  const choosePdfs=files=>{
    const selected=Array.from(files||[])

    if(!selected.length)return

    const invalid=selected.find(
      file=>
        (
          file.type!=='application/pdf' &&
          !file.name.toLowerCase().endsWith('.pdf')
        ) ||
        file.size>20*1024*1024
    )

    if(invalid){
      setError(
        t('import.onlyPdf', { name: invalid.name })
      )
      return
    }

    setError('')

    setPdfItems(current=>{
      const existing=new Set(
        current.map(
          item=>`${item.file.name}-${item.file.size}-${item.file.lastModified}`
        )
      )

      const additions=selected
        .filter(
          file=>!existing.has(
            `${file.name}-${file.size}-${file.lastModified}`
          )
        )
        .map(file=>({
          id:crypto.randomUUID(),
          file,
          title:file.name.replace(/\.pdf$/i,''),
        }))

      return [...current,...additions]
    })
  }

  const updatePdfTitle=(id,title)=>{
    setPdfItems(current=>
      current.map(
        item=>item.id===id
          ? {...item,title}
          : item
      )
    )
  }

  const removePdf=id=>{
    setPdfItems(current=>
      current.filter(item=>item.id!==id)
    )
  }

  const importPdfs=async()=>{
    if(!pdfItems.length){
      await persist({step:7})
      return
    }

    if(pdfItems.some(item=>!item.title.trim())){
      setError(t('ob.err.pdfTitles'))
      return
    }

    setBusy(true)
    setError('')

    try{
      const payload=pdfItems.map(item=>({
        song:{
          title:item.title.trim(),
          artist: t('import.artistDefault'),
          key:'–',
          bpm:'–',
          duration:'–',
        },
        file:item.file,
      }))

      const imported=await saveImportedSongs(payload)

      await persist({
        step:7,
        data:{
          ...(state?.data||{}),
          importedSongs:Array.isArray(imported)
            ? imported.length
            : pdfItems.length,
        },
      })
    }catch(e){
      setError(
        t('ob.err.importRetry', { error: e.message||t('ob.err.retry') })
      )
    }finally{
      setBusy(false)
    }
  }

  const runBandSearch=async()=>{
    if(bandSearch.trim().length<3){
      setError(t('ob.err.searchMin'))
      return
    }

    setBusy(true)
    setError('')

    try{
      const rows=await searchBands(bandSearch.trim())
      setBandResults(rows)
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const sendJoinRequest=async band=>{
    setBusy(true)
    setError('')

    try{
      const result=await requestBandJoin(band.id)

      setJoinRequests(current=>[
        result,
        ...current.filter(item=>item.id!==result.id)
      ])

      await persist({
        step:3,
        mode:'join',
        data:{
          ...(state?.data||{}),
          joinRequestId:result.id,
          joinBandId:band.id,
          joinBandName:band.name,
        },
      })
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const useInviteCode=async()=>{
    if(!inviteCode.trim()){
      setError(t('ob.err.inviteCode'))
      return
    }

    setBusy(true)
    setError('')

    try{
      const result=await joinBandByCode(inviteCode)

      await selectBand(result.band.id)

      await persist({
        step:3,
        mode:'join',
        data:{
          ...(state?.data||{}),
          joinedBandId:result.band.id,
          joinedBandName:result.band.name,
          joinedByInvite:true,
        },
      })
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const refreshJoinStatus=async()=>{
    setBusy(true)
    setError('')

    try{
      const rows=await getMyJoinRequests()
      setJoinRequests(rows)

      const id=state?.data?.joinRequestId
      const current=rows.find(item=>item.id===id)

      if(current?.status==='accepted'){
        await selectBand(current.bandId)

        await persist({
          step:4,
          mode:'join',
          data:{
            ...(state?.data||{}),
            joinedBandId:current.bandId,
            joinedBandName:current.bandName,
          },
        })
      }

      if(current?.status==='rejected')
        setError(t('ob.requestRejected'))
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  const finish=async()=>{
    setBusy(true)
    setError('')

    try{
      const saved=await completeOnboarding()
      onState(saved)
    }catch(e){
      setError(e.message)
    }finally{
      setBusy(false)
    }
  }

  /*
   * Willkommen
   */
  if(step===0){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-welcome">
          <div className="onboarding-logo">
            <Music2 size={30}/>
          </div>

          <p className="onboarding-eyebrow">
            {t('brand.songbook')}
          </p>

<h1>{t('ob.welcomeTitle')}</h1>

<p>{t('ob.welcomeBody')}</p>

          <Button onClick={()=>persist({step:1})}>
{t('ob.letsGo')}
            <ArrowRight size={18}/>
          </Button>
        </section>
      </main>
    )
  }

  /*
   * Auswahl
   */
  if(step===1){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card">
          <button className="onboarding-back" onClick={back}>
            <ArrowLeft size={18}/>
            {t('common.back')}
          </button>

          <StepHeader
            icon={Music2}
eyebrow={t('ob.yourStart')}
            title={t('ob.howStart')}
            text={t('ob.choosePath')}
          />

          <div className="onboarding-choices">
            <StartChoice
              icon={Users}
title={t('ob.mode.create')}
              text={t('ob.mode.createDetail')}
              onClick={()=>chooseMode('create')}
            />

            <StartChoice
              icon={Search}
title={t('ob.findExisting')}
              text={t('ob.mode.joinDetail')}
              onClick={()=>chooseMode('join')}
            />

            <StartChoice
              icon={Music2}
title={t('ob.mode.personal')}
              text={t('ob.mode.personalDetail')}
              onClick={()=>chooseMode('personal')}
            />
          </div>
        </section>
      </main>
    )
  }

  /*
   * BAND ANLEGEN
   */
  if(mode==='create' && step===2){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card">
          <Progress
            current={1}
            total={5}
label={t('ob.setupBand')}
          />

          <StepHeader
            icon={Users}
eyebrow={t('ob.yourBand')}
            title={activeBand ? t('ob.bandCheckTitle') : t('ob.bandNameTitle')}
            text={t('ob.bandNameHint')}
          />

          <form
            className="onboarding-form"
            onSubmit={saveBand}
          >
            <label>
<span>{t('ob.bandNameRequired')}</span>
              <input
                value={bandName}
                onChange={event=>setBandName(event.target.value)}
placeholder={t('bands.namePlaceholder')}
                maxLength={80}
                autoFocus
              />
            </label>

            <label>
<span>{t('bands.description')}</span>
              <textarea
                value={bandDescription}
                onChange={event=>setBandDescription(event.target.value)}
placeholder={t('bands.descriptionPlaceholder')}
                maxLength={300}
                rows={3}
              />
            </label>

            <div className="onboarding-upload-row">
              <label className="onboarding-logo-picker">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={chooseBandLogo}
                />

                {bandLogoPreview
? <img src={bandLogoPreview} alt={t('bands.logo')}/>
                  : <>
                      <ImagePlus size={27}/>
<strong>{t('bands.logo')}</strong>
                      <small>{t('ob.optional')}</small>
                    </>
                }
              </label>

              <div>
<strong>{t('ob.bandLogoLabel')}</strong>
<p>{t('ob.bandLogoHelp')}</p>
              </div>
            </div>

            {error&&
              <p className="onboarding-error">
                {error}
              </p>
            }

            <footer className="onboarding-actions">
              <Button variant="secondary" onClick={back}>{t('common.back')}</Button>

              <Button
                type="submit"
                disabled={busy||bandName.trim().length<2}
              >
{busy
                  ? t('common.saving')
                  : activeBand
                    ? t('songs.saveChanges')
                    : t('ob.createBand')
                }

                {!busy&&<ArrowRight size={18}/>}
              </Button>
            </footer>
          </form>
        </section>
      </main>
    )
  }

  /*
   * TEAM
   */
  if(mode==='create' && step===3){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-card-wide">
          <Progress
            current={2}
            total={5}
            label={t('ob.setupBand')}
          />

          <StepHeader
            icon={UserRound}
eyebrow={t('ob.teamTitle')}
            title={t('ob.whoTeam')}
            text={t('ob.teamHint')}
          />

          {team.length>0&&
            <div className="onboarding-member-list">
              {team.map(member=>
                <article key={member.id}>
                  <span className="onboarding-member-avatar">
                    {member.hasPhoto
                      ? <img src={memberPhoto(member)} alt=""/>
                      : member.name
                          .split(/\s+/)
                          .slice(0,2)
                          .map(part=>part[0])
                          .join('')
                          .toUpperCase()
                    }
                  </span>

                  <div>
                    <strong>{member.name}</strong>
                    <small>
                      {member.roles?.length
                        ? member.roles.join(' · ')
                        : t('team.noRoleStored')
                      }
                    </small>
                  </div>

                  <Check size={18}/>
                </article>
              )}
            </div>
          }

          <form
            className="onboarding-member-form"
            onSubmit={addMember}
          >
            <div className="onboarding-member-form-head">
              <label className="onboarding-member-photo">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={chooseMemberPhoto}
                />

                {memberPhotoPreview
? <img src={memberPhotoPreview} alt={t('team.photo')}/>
                  : <>
                      <Camera size={23}/>
<small>{t('ob.photo')}</small>
                    </>
                }
              </label>

              <label className="onboarding-grow">
<span>{t('ob.memberName')}</span>
                <input
                  value={memberName}
                  onChange={event=>setMemberName(event.target.value)}
placeholder={t('team.namePlaceholder')}
                  maxLength={100}
                />
              </label>
            </div>

            <div className="onboarding-field-block">
<span>{t('team.roles')}</span>

              <div className="onboarding-role-options">
                {roleOptions.map(role=>
                  <button
                    key={role}
                    type="button"
                    className={
                      memberRoles.includes(role)
                        ? 'selected'
                        : ''
                    }
                    onClick={()=>toggleRole(role)}
                  >
                    {memberRoles.includes(role)&&
                      <Check size={14}/>
                    }

                    {role}
                  </button>
                )}
              </div>
            </div>

            <div className="onboarding-responsibilities">
              <label>
                <input
                  type="checkbox"
                  checked={isLeader}
                  onChange={e=>setIsLeader(e.target.checked)}
                />
                {t('ob.bandLeadShort')}
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={isOrganizer}
                  onChange={e=>setIsOrganizer(e.target.checked)}
                />
                {t('team.organizer')}
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={isTechnician}
                  onChange={e=>setIsTechnician(e.target.checked)}
                />
                {t('ob.techShort')}
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={isDesigner}
                  onChange={e=>setIsDesigner(e.target.checked)}
                />
                {t('ob.designShort')}
              </label>
            </div>

            {error&&
              <p className="onboarding-error">
                {error}
              </p>
            }

            <button
              className="onboarding-add-member"
              type="submit"
              disabled={busy||memberName.trim().length<2}
            >
              <Plus size={17}/>
{busy
                ? t('common.saving')
                : t('ob.addMember')
              }
            </button>
          </form>

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              {t('common.back')}
            </Button>

            <Button onClick={finishTeam}>
{team.length
                ? t('common.next')
                : t('ob.skipMembers')
              }
              <ArrowRight size={18}/>
            </Button>
          </footer>
        </section>
      </main>
    )
  }

  /*
   * ERSTES SET
   */
  if(mode==='create' && step===4){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card">
          <Progress
            current={3}
            total={5}
            label={t('ob.setupBand')}
          />

          <StepHeader
            icon={ListMusic}
eyebrow={t('ob.firstPlan')}
            title={t('ob.whatNext')}
            text={t('ob.setHint')}
          />

          {sets.length>0&&
            <div className="onboarding-existing">
              <CheckCircle2 size={20}/>
              <div>
<strong>
                  {t('ob.setsExist', { count: sets.length })}
                </strong>
                <span>
                  {t('ob.setsExistMore')}
                </span>
              </div>
            </div>
          }

          <form
            className="onboarding-form"
            onSubmit={saveFirstSet}
          >
            <label>
<span>{t('ob.setNameRequired')}</span>
              <input
                value={setTitle}
                onChange={e=>setSetTitle(e.target.value)}
placeholder={t('sets.name')}
                maxLength={120}
              />
            </label>

            <label>
<span>{t('sets.date')}</span>
              <input
                type="date"
                value={setDate}
                onChange={e=>setSetDate(e.target.value)}
              />
            </label>

            {error&&
              <p className="onboarding-error">
                {error}
              </p>
            }

            <footer className="onboarding-actions">
              <Button variant="secondary" onClick={back}>{t('common.back')}</Button>

              <div className="onboarding-action-group">
                <button
                  type="button"
                  className="onboarding-text-button"
                  onClick={skipSet}
                >
                  {t('ob.later')}
                </button>

                <Button
                  type="submit"
                  disabled={busy||!setTitle.trim()}
                >
{busy ? t('common.saving') : t('sets.create')}
                  {!busy&&<ArrowRight size={18}/>}
                </Button>
              </div>
            </footer>
          </form>
        </section>
      </main>
    )
  }

  /*
   * TERMINE
   */
  if(mode==='create' && step===5){
    const relatedAppointments=activeSet
      ? appointments.filter(item=>item.setId===activeSet.id)
      : []

    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-card-wide">
          <Progress
            current={4}
            total={5}
            label={t('ob.setupBand')}
          />

          <StepHeader
            icon={CalendarDays}
eyebrow={t('ob.appointmentsEyebrow')}
            title={t('ob.whenMeet')}
            text={t('ob.appointmentsHint')}
          />

          {!activeSet
            ? <div className="onboarding-existing onboarding-warning">
                <CalendarDays size={20}/>
                <div>
<strong>{t('ob.noSetYet')}</strong>
<span>{t('ob.noSetWarn')}</span>
                </div>
              </div>

            : <>
                <div className="onboarding-set-context">
<small>{t('appointments.relatedSet')}</small>
                  <strong>{activeSet.title}</strong>
                  <span>
{activeSet.date||t('ob.dateOpen')}
                  </span>
                </div>

                {relatedAppointments.length>0&&
                  <div className="onboarding-appointment-list">
                    {relatedAppointments.map(item=>
                      <article key={item.id}>
                        <CalendarDays size={18}/>

                        <div>
                          <strong>{item.title}</strong>
                          <span>
                            {item.date}
                            {item.time ? ` · ${t('common.timeSuffix', { time: item.time })}` : ''}
                          </span>

                          {item.location&&
                            <small>{item.location}</small>
                          }
                        </div>

                        <Check size={17}/>
                      </article>
                    )}
                  </div>
                }

                <form
                  className="onboarding-form onboarding-appointment-form"
                  onSubmit={saveAppointment}
                >
                  <label>
<span>{t('appointments.typeLabel')}</span>

                    <select
                      value={appointmentType}
                      onChange={event=>{
                        const value=event.target.value
                        setAppointmentType(value)
                        setAppointmentTitle(
                          appointmentTypes[value]
                        )
                      }}
                    >
                      {Object.entries(appointmentTypes).map(
                        ([value,label])=>
                          <option key={value} value={value}>
                            {label}
                          </option>
                      )}
                    </select>
                  </label>

                  <label>
<span>{t('ob.titleRequired')}</span>
                    <input
                      value={appointmentTitle}
                      onChange={e=>setAppointmentTitle(e.target.value)}
placeholder={t('appointments.types.rehearsal')}
                    />
                  </label>

                  <div className="onboarding-form-columns">
                    <label>
<span>{t('ob.dateRequired')}</span>
                      <input
                        type="date"
                        value={appointmentDate}
                        onChange={e=>setAppointmentDate(e.target.value)}
                      />
                    </label>

                    <label>
<span>{t('appointments.time')}</span>
                      <input
                        type="time"
                        value={appointmentTime}
                        onChange={e=>setAppointmentTime(e.target.value)}
                      />
                    </label>
                  </div>

                  <label>
<span>{t('appointments.location')}</span>
                    <input
                      value={appointmentLocation}
                      onChange={e=>setAppointmentLocation(e.target.value)}
placeholder={t('appointments.locationPlaceholder')}
                    />
                  </label>

                  <label>
<span>{t('appointments.notes')}</span>
                    <textarea
                      value={appointmentNotes}
                      onChange={e=>setAppointmentNotes(e.target.value)}
placeholder={t('appointments.notesPlaceholder')}
                      rows={3}
                    />
                  </label>

                  {error&&
                    <p className="onboarding-error">
                      {error}
                    </p>
                  }

                  <button
                    type="submit"
                    className="onboarding-add-member"
                    disabled={
                      busy||
                      !appointmentTitle.trim()||
                      !appointmentDate
                    }
                  >
                    <Plus size={17}/>
{busy
                      ? t('common.saving')
                      : t('ob.addAppointment')
                    }
                  </button>
                </form>
              </>
          }

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              {t('common.back')}
            </Button>

            <Button onClick={continueAfterAppointments}>
{relatedAppointments.length
                ? t('common.next')
                : t('ob.later')
              }
              <ArrowRight size={18}/>
            </Button>
          </footer>
        </section>
      </main>
    )
  }

  /*
   * SONGS
   */
  if(mode==='create' && step===6){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-card-wide">
          <Progress
            current={5}
            total={5}
            label={t('ob.setupBand')}
          />

          <StepHeader
            icon={Music2}
eyebrow={t('ob.library')}
            title={t('ob.songsMissing')}
            text={t('ob.songsHint')}
          />

          <label className="onboarding-pdf-drop">
            <input
              type="file"
              multiple
              accept="application/pdf,.pdf"
              onChange={event=>{
                choosePdfs(event.target.files)
                event.target.value=''
              }}
            />

            <Upload size={29}/>
<strong>{t('ob.choosePdfs')}</strong>
<span>{t('ob.pdfLimit')}</span>
          </label>

          {pdfItems.length>0&&
            <div className="onboarding-pdf-list">
              {pdfItems.map((item,index)=>
                <article key={item.id}>
                  <span className="onboarding-pdf-number">
                    {index+1}
                  </span>

                  <FileText size={20}/>

                  <div>
                    <input
                      value={item.title}
                      onChange={e=>
                        updatePdfTitle(
                          item.id,
                          e.target.value
                        )
                      }
aria-label={t('import.titleOf', { file: item.file.name })}
                    />

                    <small>
                      {item.file.name}
                      {' · '}
                      {(item.file.size/1024/1024).toFixed(2)} MB
                    </small>
                  </div>

                  <button
                    type="button"
                    onClick={()=>removePdf(item.id)}
aria-label={t('ob.removePdf')}
                  >
                    <Trash2 size={17}/>
                  </button>
                </article>
              )}
            </div>
          }

          {error&&
            <p className="onboarding-error">
              {error}
            </p>
          }

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              {t('common.back')}
            </Button>

            <Button onClick={importPdfs} disabled={busy}>
{busy
                ? t('ob.importing')
                : pdfItems.length
                  ? t('import.nSongs', { count: pdfItems.length })
                  : t('ob.later')
              }

              {!busy&&<ArrowRight size={18}/>}
            </Button>
          </footer>
        </section>
      </main>
    )
  }

  /*
   * BESTEHENDE BAND
   */
  if(mode==='join' && step===2){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-card-wide">
          <Progress
            current={1}
            total={2}
label={t('ob.joinEyebrow')}
          />

          <StepHeader
            icon={Search}
eyebrow={t('ob.existingBand')}
            title={t('ob.joinTitle')}
            text={t('ob.joinHint')}
          />

          <div className="join-method-grid">
            <section className="join-method">
<strong>{t('bands.search')}</strong>
<p>{t('ob.joinSearchHint')}</p>

              <div className="join-search-row">
                <input
                  value={bandSearch}
                  onChange={e=>setBandSearch(e.target.value)}
                  onKeyDown={e=>{
                    if(e.key==='Enter'){
                      e.preventDefault()
                      runBandSearch()
                    }
                  }}
placeholder={t('bands.name')}
                />

                <button
                  type="button"
                  onClick={runBandSearch}
                  disabled={busy||bandSearch.trim().length<3}
                >
<Search size={18}/>
                  {t('common.search')}
                </button>
              </div>

              {bandResults.length>0&&
                <div className="join-results">
                  {bandResults.map(band=>
                    <article key={band.id}>
                      <span className="join-band-icon">
                        <Users size={19}/>
                      </span>

                      <div>
                        <strong>{band.name}</strong>

                        {band.description&&
                          <small>{band.description}</small>
                        }
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={()=>sendJoinRequest(band)}
                      >
{t('bands.sendRequest')}
                      </button>
                    </article>
                  )}
                </div>
              }

              {bandResults.length===0 && bandSearch.length>=3 && !busy&&
<small className="join-hint">{t('ob.joinSearchEmpty')}</small>
              }
            </section>

            <div className="join-or">
<span>{t('ob.or')}</span>
            </div>

            <section className="join-method">
<strong>{t('bands.inviteCode')}</strong>

<p>{t('ob.inviteHelp')}</p>

              <div className="join-code-row">
                <input
                  value={inviteCode}
                  onChange={e=>
                    setInviteCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g,'')
                    )
                  }
                  maxLength={8}
                  placeholder="AB12CD34"
                />

                <button
                  type="button"
                  onClick={useInviteCode}
                  disabled={busy||!inviteCode.trim()}
                >
{t('bands.join')}
                </button>
              </div>
            </section>
          </div>

          {error&&
            <p className="onboarding-error">
              {error}
            </p>
          }

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              {t('common.back')}
            </Button>
          </footer>
        </section>
      </main>
    )
  }

  if(mode==='join' && step===3){
    const viaInvite=Boolean(state?.data?.joinedByInvite)

    if(viaInvite){
      return (
        <main className="onboarding-shell">
          <section className="onboarding-card onboarding-welcome">
            <div className="onboarding-complete">
              <CheckCircle2 size={38}/>
            </div>

<p className="onboarding-eyebrow">{t('ob.joinedEyebrow')}</p>

<h1>{t('ob.welcomeBand', { name: state?.data?.joinedBandName||t('ob.yourBandFallback') })}</h1>

<p>{t('ob.joinedBody')}</p>

            <Button onClick={finish} disabled={busy}>
{t('ob.openSongbook')}
              <ArrowRight size={18}/>
            </Button>
          </section>
        </main>
      )
    }

    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-welcome">
          <div className="onboarding-step-icon">
            <Clock3 size={31}/>
          </div>

<p className="onboarding-eyebrow">{t('ob.requestEyebrow')}</p>

<h1>{t('ob.requestSent')}</h1>

<p>{t('ob.requestBody', { name: state?.data?.joinBandName||t('ob.theBand') })}</p>

          {error&&
            <p className="onboarding-error">
              {error}
            </p>
          }

          <Button
            onClick={refreshJoinStatus}
            disabled={busy}
          >
{busy ? t('ob.checking') : t('ob.checkStatus')}
          </Button>

          <button
            type="button"
            className="onboarding-text"
            onClick={back}
          >
{t('ob.otherBand')}
          </button>
        </section>
      </main>
    )
  }

  if(mode==='join' && step>=4){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card onboarding-welcome">
          <div className="onboarding-complete">
            <CheckCircle2 size={38}/>
          </div>

<p className="onboarding-eyebrow">{t('ob.memberConfirmed')}</p>

          <h1>
            {t('ob.welcomeBand', { name: state?.data?.joinedBandName||t('ob.yourBandFallback') })}
          </h1>

<p>{t('ob.memberConfirmedBody')}</p>

          <Button onClick={finish} disabled={busy}>
            {t('ob.openSongbook')}
            <ArrowRight size={18}/>
          </Button>
        </section>
      </main>
    )
  }

  /*
   * PERSÖNLICH
   */
  if(mode==='personal'){
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card">
          <StepHeader
            icon={Music2}
eyebrow={t('ob.mode.personal')}
            title={t('ob.personalReady')}
            text={t('ob.mode.personalBody')}
          />

          <div className="onboarding-preview">
<strong>{t('ob.personalSelected')}</strong>
<span>{t('ob.personalLater')}</span>
          </div>

          {error&&
            <p className="onboarding-error">
              {error}
            </p>
          }

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              {t('common.back')}
            </Button>

            <Button onClick={finish} disabled={busy}>
{busy ? t('common.pleaseWait') : t('ob.openSongbook')}
              {!busy&&<ArrowRight size={18}/>}
            </Button>
          </footer>
        </section>
      </main>
    )
  }

  /*
   * ABSCHLUSS
   */
  return (
    <main className="onboarding-shell">
      <section className="onboarding-card onboarding-welcome">
        <div className="onboarding-complete">
          <CheckCircle2 size={39}/>
        </div>

        <p className="onboarding-eyebrow">
          {t('ob.finishEyebrow')}
        </p>

        <h1>{t('ob.readyTitle')}</h1>

        <p>
          {t('ob.finishSaved')}
        </p>

        {error&&
          <p className="onboarding-error">
            {error}
          </p>
        }

        <Button onClick={finish} disabled={busy}>
          {busy ? t('common.pleaseWait') : t('ob.openSongbook')}
          {!busy&&<ArrowRight size={18}/>}
        </Button>
      </section>
    </main>
  )
}

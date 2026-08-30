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

const appointmentTypes={
  rehearsal:'Bandprobe',
  planning:'Planungstreffen',
  soundcheck:'Technik & Soundcheck',
  other:'Sonstiger Termin',
}

const roleOptions = [
  'Gesang',
  'Akustikgitarre',
  'E-Gitarre',
  'Bass',
  'Piano / Keys',
  'Schlagzeug',
  'Percussion',
  'Bläser',
  'Streicher',
  'Technik',
  'Licht',
  'Organisation',
]

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
  const percentage=Math.round((current/total)*100)

  return (
    <>
      <div className="onboarding-topline">
        <span>{label}</span>
        <span>Schritt {current} von {total}</span>
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
  const step=Number(state?.step)||0
  const mode=state?.mode||''

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
  const [appointmentTitle,setAppointmentTitle]=useState('Bandprobe')
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
      setError('Bitte gib einen Bandnamen ein.')
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
      setError('Bitte gib den Namen des Bandmitglieds ein.')
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
      setError('Bitte gib dem Set einen Namen.')
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
      setError('Für einen Termin wird zunächst ein Set benötigt.')
      return
    }

    if(!appointmentTitle.trim()||!appointmentDate){
      setError('Bitte Titel und Datum des Termins eintragen.')
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
      setAppointmentTitle('Bandprobe')
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
        `${invalid.name}: Bitte nur PDFs bis maximal 20 MB auswählen.`
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
      setError('Bitte für jede PDF einen Songtitel eintragen.')
      return
    }

    setBusy(true)
    setError('')

    try{
      const payload=pdfItems.map(item=>({
        song:{
          title:item.title.trim(),
          artist:'Importierte PDF',
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
        `Import fehlgeschlagen: ${e.message||'Bitte erneut versuchen.'}`
      )
    }finally{
      setBusy(false)
    }
  }

  const runBandSearch=async()=>{
    if(bandSearch.trim().length<3){
      setError('Bitte mindestens drei Zeichen eingeben.')
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
      setError('Bitte Einladungscode eingeben.')
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
        setError('Die Bandleitung hat die Anfrage abgelehnt.')
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
            Worship Songbook
          </p>

          <h1>Herzlich willkommen.</h1>

          <p>
            Wir richten dein Songbook gemeinsam ein.
            Das dauert nur wenige Minuten.
          </p>

          <Button onClick={()=>persist({step:1})}>
            Los geht's
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
            Zurück
          </button>

          <StepHeader
            icon={Music2}
            eyebrow="Dein Start"
            title="Wie möchtest du beginnen?"
            text="Wähle den Weg, der zu dir passt."
          />

          <div className="onboarding-choices">
            <StartChoice
              icon={Users}
              title="Neue Band anlegen"
              text="Ich leite oder gründe eine Band."
              onClick={()=>chooseMode('create')}
            />

            <StartChoice
              icon={Search}
              title="Bestehende Band finden"
              text="Ich bin bereits Mitglied einer Band."
              onClick={()=>chooseMode('join')}
            />

            <StartChoice
              icon={Music2}
              title="Persönliches Songbook"
              text="Ich möchte zunächst ohne Band starten."
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
            label="Band einrichten"
          />

          <StepHeader
            icon={Users}
            eyebrow="Deine Band"
            title={activeBand ? 'Deine Band prüfen.' : 'Wie heißt deine Band?'}
            text="Name, Beschreibung und Logo kannst du später jederzeit ändern."
          />

          <form
            className="onboarding-form"
            onSubmit={saveBand}
          >
            <label>
              <span>Bandname *</span>
              <input
                value={bandName}
                onChange={event=>setBandName(event.target.value)}
                placeholder="Name deiner Band"
                maxLength={80}
                autoFocus
              />
            </label>

            <label>
              <span>Beschreibung</span>
              <textarea
                value={bandDescription}
                onChange={event=>setBandDescription(event.target.value)}
                placeholder="Optional, z. B. Worship-Team unserer Gemeinde"
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
                  ? <img src={bandLogoPreview} alt="Band-Logo"/>
                  : <>
                      <ImagePlus size={27}/>
                      <strong>Band-Logo</strong>
                      <small>Optional</small>
                    </>
                }
              </label>

              <div>
                <strong>Logo deiner Band</strong>
                <p>
                  JPG, PNG oder WebP. Du kannst das Logo auch später
                  in der Bandverwaltung hochladen.
                </p>
              </div>
            </div>

            {error&&
              <p className="onboarding-error">
                {error}
              </p>
            }

            <footer className="onboarding-actions">
              <Button variant="secondary" onClick={back}>
                Zurück
              </Button>

              <Button
                type="submit"
                disabled={busy||bandName.trim().length<2}
              >
                {busy
                  ? 'Speichert …'
                  : activeBand
                    ? 'Änderungen speichern'
                    : 'Band anlegen'
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
            label="Band einrichten"
          />

          <StepHeader
            icon={UserRound}
            eyebrow="Dein Team"
            title="Wer gehört zu deiner Band?"
            text="Füge die wichtigsten Mitglieder hinzu. Weitere Personen kannst du später jederzeit ergänzen."
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
                        : 'Noch keine Aufgabe hinterlegt'
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
                  ? <img src={memberPhotoPreview} alt="Profilbild"/>
                  : <>
                      <Camera size={23}/>
                      <small>Foto</small>
                    </>
                }
              </label>

              <label className="onboarding-grow">
                <span>Name des Mitglieds *</span>
                <input
                  value={memberName}
                  onChange={event=>setMemberName(event.target.value)}
                  placeholder="Vor- und Nachname"
                  maxLength={100}
                />
              </label>
            </div>

            <div className="onboarding-field-block">
              <span>Instrumente und Aufgaben</span>

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
                Bandleitung
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={isOrganizer}
                  onChange={e=>setIsOrganizer(e.target.checked)}
                />
                Organisation
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={isTechnician}
                  onChange={e=>setIsTechnician(e.target.checked)}
                />
                Technik
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={isDesigner}
                  onChange={e=>setIsDesigner(e.target.checked)}
                />
                Gestaltung / Medien
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
                ? 'Speichert …'
                : 'Mitglied hinzufügen'
              }
            </button>
          </form>

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              Zurück
            </Button>

            <Button onClick={finishTeam}>
              {team.length
                ? 'Weiter'
                : 'Ohne Mitglieder weiter'
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
            label="Band einrichten"
          />

          <StepHeader
            icon={ListMusic}
            eyebrow="Erste Planung"
            title="Was plant ihr als Nächstes?"
            text="Lege ein erstes Set an. Songs und weitere Details kommen anschließend."
          />

          {sets.length>0&&
            <div className="onboarding-existing">
              <CheckCircle2 size={20}/>
              <div>
                <strong>
                  {sets.length} {sets.length===1 ? 'Set' : 'Sets'} bereits vorhanden
                </strong>
                <span>
                  Du kannst trotzdem ein weiteres Set anlegen oder diesen Schritt überspringen.
                </span>
              </div>
            </div>
          }

          <form
            className="onboarding-form"
            onSubmit={saveFirstSet}
          >
            <label>
              <span>Name des Sets *</span>
              <input
                value={setTitle}
                onChange={e=>setSetTitle(e.target.value)}
                placeholder="Name des Sets"
                maxLength={120}
              />
            </label>

            <label>
              <span>Datum</span>
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
              <Button variant="secondary" onClick={back}>
                Zurück
              </Button>

              <div className="onboarding-action-group">
                <button
                  type="button"
                  className="onboarding-text-button"
                  onClick={skipSet}
                >
                  Später
                </button>

                <Button
                  type="submit"
                  disabled={busy||!setTitle.trim()}
                >
                  {busy ? 'Speichert …' : 'Set anlegen'}
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
            label="Band einrichten"
          />

          <StepHeader
            icon={CalendarDays}
            eyebrow="Proben und Termine"
            title="Wann trefft ihr euch?"
            text="Plane die ersten Bandproben oder Vorbereitungstermine."
          />

          {!activeSet
            ? <div className="onboarding-existing onboarding-warning">
                <CalendarDays size={20}/>
                <div>
                  <strong>Noch kein Set vorhanden</strong>
                  <span>
                    Termine werden im aktuellen Songbook einem Set zugeordnet.
                    Du kannst diesen Schritt überspringen und später ein Set anlegen.
                  </span>
                </div>
              </div>

            : <>
                <div className="onboarding-set-context">
                  <small>Zugehöriges Set</small>
                  <strong>{activeSet.title}</strong>
                  <span>
                    {activeSet.date||'Datum noch offen'}
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
                            {item.time ? ` · ${item.time} Uhr` : ''}
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
                    <span>Art des Termins</span>

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
                    <span>Titel *</span>
                    <input
                      value={appointmentTitle}
                      onChange={e=>setAppointmentTitle(e.target.value)}
                      placeholder="Bandprobe"
                    />
                  </label>

                  <div className="onboarding-form-columns">
                    <label>
                      <span>Datum *</span>
                      <input
                        type="date"
                        value={appointmentDate}
                        onChange={e=>setAppointmentDate(e.target.value)}
                      />
                    </label>

                    <label>
                      <span>Uhrzeit</span>
                      <input
                        type="time"
                        value={appointmentTime}
                        onChange={e=>setAppointmentTime(e.target.value)}
                      />
                    </label>
                  </div>

                  <label>
                    <span>Ort</span>
                    <input
                      value={appointmentLocation}
                      onChange={e=>setAppointmentLocation(e.target.value)}
                      placeholder="Proberaum, Kirche …"
                    />
                  </label>

                  <label>
                    <span>Notizen</span>
                    <textarea
                      value={appointmentNotes}
                      onChange={e=>setAppointmentNotes(e.target.value)}
                      placeholder="Was soll geprobt oder vorbereitet werden?"
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
                      ? 'Speichert …'
                      : 'Termin hinzufügen'
                    }
                  </button>
                </form>
              </>
          }

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              Zurück
            </Button>

            <Button onClick={continueAfterAppointments}>
              {relatedAppointments.length
                ? 'Weiter'
                : 'Später'
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
            label="Band einrichten"
          />

          <StepHeader
            icon={Music2}
            eyebrow="Deine Bibliothek"
            title="Jetzt fehlen nur noch eure Songs."
            text="Importiere direkt die ersten PDFs oder erledige das später im Songbook."
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
            <strong>PDFs auswählen</strong>
            <span>
              Mehrere Dateien möglich · je maximal 20 MB
            </span>
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
                      aria-label={`Titel von ${item.file.name}`}
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
                    aria-label="PDF entfernen"
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
              Zurück
            </Button>

            <Button onClick={importPdfs} disabled={busy}>
              {busy
                ? 'Importiert …'
                : pdfItems.length
                  ? `${pdfItems.length} ${pdfItems.length===1?'Song':'Songs'} importieren`
                  : 'Später'
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
            label="Band beitreten"
          />

          <StepHeader
            icon={Search}
            eyebrow="Bestehende Band"
            title="Finde deine Band."
            text="Suche nach dem Bandnamen oder verwende einen Einladungscode deiner Bandleitung."
          />

          <div className="join-method-grid">
            <section className="join-method">
              <strong>Band suchen</strong>
              <p>
                Suche nach dem Namen. Der Beitritt wird anschließend
                von der Bandleitung bestätigt.
              </p>

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
                  placeholder="Bandname"
                />

                <button
                  type="button"
                  onClick={runBandSearch}
                  disabled={busy||bandSearch.trim().length<3}
                >
                  <Search size={18}/>
                  Suchen
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
                        Anfrage senden
                      </button>
                    </article>
                  )}
                </div>
              }

              {bandResults.length===0 && bandSearch.length>=3 && !busy&&
                <small className="join-hint">
                  Nach der Suche erscheinen hier passende Bands.
                </small>
              }
            </section>

            <div className="join-or">
              <span>oder</span>
            </div>

            <section className="join-method">
              <strong>Einladungscode</strong>

              <p>
                Mit einem gültigen Einladungscode kannst du der Band
                direkt beitreten.
              </p>

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
                  Beitreten
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
              Zurück
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

            <p className="onboarding-eyebrow">
              Band beigetreten
            </p>

            <h1>
              Willkommen bei {state?.data?.joinedBandName||'deiner Band'}.
            </h1>

            <p>
              Deine Mitgliedschaft wurde bestätigt.
              Der gemeinsame Bandbereich steht dir jetzt direkt
              im normalen Songbook zur Verfügung.
            </p>

            <Button onClick={finish} disabled={busy}>
              Songbook öffnen
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

          <p className="onboarding-eyebrow">
            Beitrittsanfrage
          </p>

          <h1>Anfrage gesendet.</h1>

          <p>
            Deine Anfrage für
            {' '}
            <strong>
              {state?.data?.joinBandName||'die Band'}
            </strong>
            {' '}
            wartet auf Bestätigung durch die Bandleitung.
          </p>

          {error&&
            <p className="onboarding-error">
              {error}
            </p>
          }

          <Button
            onClick={refreshJoinStatus}
            disabled={busy}
          >
            {busy ? 'Prüft …' : 'Status prüfen'}
          </Button>

          <button
            type="button"
            className="onboarding-text"
            onClick={back}
          >
            Andere Band auswählen
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

          <p className="onboarding-eyebrow">
            Mitgliedschaft bestätigt
          </p>

          <h1>
            Willkommen bei {state?.data?.joinedBandName||'deiner Band'}.
          </h1>

          <p>
            Die Bandleitung hat deinen Beitritt bestätigt.
          </p>

          <Button onClick={finish} disabled={busy}>
            Songbook öffnen
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
            eyebrow="Persönliches Songbook"
            title="Du kannst direkt loslegen."
            text="Du brauchst keine Band. Sets und Songs kannst du anschließend in deinem persönlichen Songbook verwalten."
          />

          <div className="onboarding-preview">
            <strong>Persönlicher Bereich ausgewählt</strong>
            <span>
              Du kannst später jederzeit zusätzlich eine Band anlegen oder einer bestehenden Band beitreten.
            </span>
          </div>

          {error&&
            <p className="onboarding-error">
              {error}
            </p>
          }

          <footer className="onboarding-actions">
            <Button variant="secondary" onClick={back}>
              Zurück
            </Button>

            <Button onClick={finish} disabled={busy}>
              {busy ? 'Bitte warten …' : 'Songbook öffnen'}
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
          Einrichtung abgeschlossen
        </p>

        <h1>Dein Songbook ist bereit.</h1>

        <p>
          Deine Einrichtung wurde gespeichert.
          Beim nächsten Login öffnet sich direkt Worship Songbook.
        </p>

        {error&&
          <p className="onboarding-error">
            {error}
          </p>
        }

        <Button onClick={finish} disabled={busy}>
          {busy ? 'Bitte warten …' : 'Songbook öffnen'}
          {!busy&&<ArrowRight size={18}/>}
        </Button>
      </section>
    </main>
  )
}

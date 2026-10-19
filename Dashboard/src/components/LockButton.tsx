import { Lock } from 'lucide-react'
import { useState } from 'react'
import { runCommand, useFeature } from '../store/device'
import { logActivity } from '../store/activity'
import { toast } from '../store/toasts'
import { Button, ConfirmDialog } from './ui/primitives'

/** Manual lock. Always asks first, and never claims the workstation is locked: only the device's own report does. */
export function LockButton({ size = 'md', variant = 'secondary' }: { size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' | 'danger' }) {
  const f = useFeature('workstationLock')
  const [open, setOpen] = useState(false)
  const confirm = async () => {
    setOpen(false)
    const res = await runCommand('workstationLock', 'lock')
    if (res.ok) {
      logActivity({ category: 'security', title: 'Manual lock requested', detail: 'The device acknowledged the request. Lock state shows once it reports back.' })
      toast({ tone: 'info', title: 'Lock request acknowledged', detail: 'Waiting for the device to report the workstation as locked.' })
    }
  }
  return (
    <>
      <Button size={size} variant={variant} icon={Lock} disabled={!f.usable} loading={f.pending} onClick={() => setOpen(true)} title={f.usable ? undefined : f.reason}>
        Lock workstation
      </Button>
      <ConfirmDialog open={open} title="Lock this workstation?" confirmLabel="Lock now" danger onCancel={() => setOpen(false)} onConfirm={confirm}
        body="Your computer will be locked and you'll need to authenticate to continue. Unsaved work is not affected." />
    </>
  )
}

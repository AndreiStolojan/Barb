// Contact form, reachable from the rail on every screen.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { sendContactMessage } from '@/api/contactApi';

export function SupportDialog({ open, onOpenChange }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const send = useAsyncAction(async () => {
    await sendContactMessage({ subject: subject.trim() || undefined, message: message.trim() });
    setSubject('');
    setMessage('');
    onOpenChange(false);
    toast.success('Message sent. We reply to your sign-in email.');
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Contact support</AlertDialogTitle>
          <AlertDialogDescription>Ask a question or report a problem. Replies go to your sign-in email.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="support-subject">Subject</Label>
            <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="support-message">Message</Label>
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="What happened, and what did you expect?"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="primary"
            disabled={send.loading || message.trim().length === 0}
            onClick={() => send.run().catch((e) => toast.error(e.message || 'Could not send the message.'))}
          >
            {send.loading && <Loader2 className="animate-spin" />}
            Send message
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

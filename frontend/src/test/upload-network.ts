// Fake only the network boundary; the production request and modal stay real.
export class UploadNetwork extends EventTarget {
  static instances: UploadNetwork[] = []
  static automatic = true
  upload = new EventTarget()
  status = 0
  responseText = ''
  withCredentials = false
  method = ''
  url = ''
  headers = new Headers()
  body: FormData | null = null
  private finished = false
  private controller = new AbortController()
  constructor() { super(); UploadNetwork.instances.push(this) }
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(name: string, value: string) { this.headers.set(name, value) }
  send(body: FormData) {
    this.body = body
    if (!UploadNetwork.automatic) return
    fetch(this.url, { method: this.method, headers: this.headers, body, credentials: 'same-origin', signal: this.controller.signal })
      .then(async response => { this.finish(response.status, await response.text()) })
      .catch(() => { if (!this.finished) this.dispatchEvent(new Event('error')) })
  }
  progress(loaded: number, total = 100, lengthComputable = true) {
    this.upload.dispatchEvent(new ProgressEvent('progress', { loaded, total, lengthComputable }))
  }
  finish(status: number, responseText: string) {
    if (this.finished) return
    this.finished = true; this.status = status; this.responseText = responseText
    this.dispatchEvent(new Event('load'))
  }
  abort() {
    if (this.finished) return
    this.finished = true; this.controller.abort()
    this.dispatchEvent(new Event('abort'))
  }
}

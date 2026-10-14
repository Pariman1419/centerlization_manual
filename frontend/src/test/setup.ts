import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { UploadNetwork } from './upload-network'

beforeEach(() => {
  UploadNetwork.instances = []; UploadNetwork.automatic = true
  vi.stubGlobal('XMLHttpRequest', UploadNetwork)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }

export function setDataTransferAnnotations(transfer: Pick<DataTransfer, 'setData'>, annotations: unknown[]) {
  transfer.setData('application/x-zotero-annotations', JSON.stringify(annotations));
}

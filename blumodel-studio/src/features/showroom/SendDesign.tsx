/** Where "Send this design to <Company>" sits: the editor's summary/estimate footer, after a download, the share page. */
export type SendPlace = 'summary' | 'export' | 'share';

export interface SendDesignProps {
  where: SendPlace;
  hidden?: boolean;
}

/** Placeholder until the Send flow lands (item 4). */
export function SendDesign(_props: SendDesignProps): JSX.Element | null {
  return null;
}

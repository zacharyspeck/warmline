import type { SVGProps, ComponentType } from "react";
import {
  ChromeIcon,
  GoogleIcon,
  InstagramIcon,
  LinkedinIcon,
  LumaIcon,
  OutlookIcon,
  XIcon,
} from "@/components/icons/brand";
import { ClockIcon, InfoIcon, ShieldIcon, UsersIcon } from "@/components/icons";

export type Provider =
  | "google"
  | "linkedin"
  | "instagram"
  | "twitter"
  | "outlook"
  | "luma"
  | "extension";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export type GuideStep = { text: string; warn?: string };

/** A self-serve data export the user downloads, then uploads back to us. */
export type ManualSpec = {
  /** The provider's own export/download page. */
  exportUrl: string;
  /** Human label for accepted formats, shown in the dropzone. */
  accept: string;
  /** `accept` attribute for the file input. */
  acceptMime: string;
  /** Steps shown in the in-app guide before we send them to the provider. */
  guide: GuideStep[];
};

/** A direct OAuth link (Google, Outlook). We never see message bodies. */
export type OauthSpec = {
  privacy: string;
  buttonLabel: string;
};

/** Automatic transfer via a third-party data-transfer partner (Instagram). */
export type AutoSpec = {
  partner: string;
  partnerNote: string;
  scopes: { key: string; label: string; sub: string; required?: boolean }[];
  buttonLabel: string;
};

/** The browser extension that reads LinkedIn mutuals from the user's session. */
export type ExtensionSpec = {
  /** Where to grab the unpacked extension. */
  downloadUrl: string;
  intro: string;
  steps: GuideStep[];
  buttonLabel: string;
};

export type ConnectorDef = {
  provider: Provider;
  name: string;
  Icon: IconType;
  /** One-line value prop shown when the source isn't linked yet. */
  blurb: string;
  beta?: boolean;
  oauth?: OauthSpec;
  manual?: ManualSpec;
  auto?: AutoSpec;
  extension?: ExtensionSpec;
};

export const CONNECTORS: ConnectorDef[] = [
  {
    provider: "google",
    name: "Google",
    Icon: GoogleIcon,
    blurb: "Add your Google contacts, calendar, and email headers.",
    oauth: {
      privacy:
        "Make your network searchable by adding your calendar, contacts, or email headers. You choose what to share. For email, we only read headers, never message bodies.",
      buttonLabel: "Connect Google",
    },
  },
  {
    provider: "linkedin",
    name: "LinkedIn",
    Icon: LinkedinIcon,
    blurb: "Add your LinkedIn connections.",
    manual: {
      exportUrl: "https://www.linkedin.com/mypreferences/d/download-my-data",
      accept: "ZIP file accepted",
      acceptMime: ".zip,application/zip",
      guide: [
        {
          text: "Select Download larger data archive (the top option).",
          warn: "The second option won't work, it doesn't include your connections.",
        },
        { text: "Click Request archive." },
      ],
    },
  },
  {
    provider: "instagram",
    name: "Instagram",
    Icon: InstagramIcon,
    blurb: "Add your mutual Instagram followers.",
    beta: true,
    auto: {
      partner: "Fabric",
      partnerNote:
        "Fabric partners with Meta to transfer your Instagram connections safely and easily.",
      scopes: [
        {
          key: "connections",
          label: "Connections",
          sub: "Followers and following",
          required: true,
        },
        {
          key: "interactions",
          label: "Interactions",
          sub: "Story likes, post likes, and comment metadata",
        },
      ],
      buttonLabel: "Connect with Fabric",
    },
    manual: {
      exportUrl: "https://accountscenter.instagram.com/info_and_permissions/dyi/",
      accept: "ZIP, JSON, or HTML accepted",
      acceptMime: ".zip,.json,.html,application/zip,application/json,text/html",
      guide: [
        { text: "Request a download of your information from Instagram." },
        { text: "Choose Connections, then download it as JSON or HTML." },
      ],
    },
  },
  {
    provider: "twitter",
    name: "Twitter",
    Icon: XIcon,
    blurb: "Add your Twitter followers.",
    manual: {
      exportUrl: "https://x.com/settings/download_your_data",
      accept: "ZIP file accepted",
      acceptMime: ".zip,application/zip",
      guide: [{ text: "Request your archive on the next screen." }],
    },
  },
  {
    provider: "luma",
    name: "Luma",
    Icon: LumaIcon,
    blurb: "Add your Luma events and guests.",
    manual: {
      exportUrl: "https://lu.ma/home",
      accept: "CSV file accepted",
      acceptMime: ".csv,text/csv",
      guide: [
        { text: "Open an event you host and go to the Guests tab." },
        { text: "Click Export and download the guest list as CSV." },
      ],
    },
  },
  {
    provider: "outlook",
    name: "Outlook",
    Icon: OutlookIcon,
    blurb: "Add your Outlook contacts.",
    oauth: {
      privacy:
        "Connect your Outlook account so we can find your connections from recent email activity. We only read email headers, never message bodies.",
      buttonLabel: "Connect Outlook",
    },
  },
  {
    provider: "extension",
    name: "Chrome Extension",
    Icon: ChromeIcon,
    blurb: "Capture your LinkedIn mutual connections.",
    extension: {
      downloadUrl: "https://github.com/warmline/extension/releases/latest",
      intro:
        "Mutual connections aren't exposed by any API; they're only visible in LinkedIn's logged-in UI. The extension reads them from profiles you open, in your own session",
      steps: [
        { text: "Download the Warmline extension and unzip it." },
        {
          text: "Open chrome://extensions and turn on Developer mode (top right).",
        },
        { text: "Click Load unpacked and select the unzipped folder." },
        {
          text: "Pin Warmline, then open a Lead's LinkedIn profile to capture mutuals.",
        },
      ],
      buttonLabel: "I've installed it",
    },
  },
];

/** The "How connectors work" reassurance points. */
export const HOW_IT_WORKS: { Icon: IconType; title: string; body: string }[] = [
  {
    Icon: UsersIcon,
    title: "We research your connections",
    body: "We automatically find professional info, social profiles, and other public details about each person you share with us.",
  },
  {
    Icon: ClockIcon,
    title: "Processing takes a bit",
    body: "After connecting, it can take up to a couple hours to enrich and index your connections. We'll email you when it's ready.",
  },
  {
    Icon: ShieldIcon,
    title: "Your data stays private",
    body: "We never share, sell, or use your data to train AI models. Only you, your friends, and groups you join can search your connections.",
  },
  {
    Icon: InfoIcon,
    title: "We don't overshare",
    body: "We never reveal the contents or recency of your communications. You can delete your sensitive connections at any time.",
  },
];

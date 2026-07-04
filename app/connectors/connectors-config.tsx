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
    blurb: "Add your Google contacts and calendar",
    oauth: {
      privacy:
        "Make your network searchable by adding your calendar and contacts. You choose what to share; the requested permissions are contacts, calendar, and your account's basic identity",
      buttonLabel: "Connect Google",
    },
  },
  {
    provider: "linkedin",
    name: "LinkedIn",
    Icon: LinkedinIcon,
    blurb: "Add your LinkedIn connections",
    manual: {
      exportUrl: "https://www.linkedin.com/mypreferences/d/download-my-data",
      accept: "ZIP file accepted",
      acceptMime: ".zip,application/zip",
      guide: [
        {
          text: "Select Download larger data archive (the top option)",
          warn: "The second option won't work, it doesn't include your connections",
        },
        { text: "Click Request archive" },
      ],
    },
  },
  {
    provider: "instagram",
    name: "Instagram",
    Icon: InstagramIcon,
    blurb: "Add your mutual Instagram followers",
    beta: true,
    auto: {
      partner: "Fabric",
      partnerNote:
        "Fabric partners with Meta to transfer your Instagram connections safely and easily",
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
        { text: "Request a download of your information from Instagram" },
        { text: "Choose Connections, then download it as JSON or HTML" },
      ],
    },
  },
  {
    provider: "twitter",
    name: "Twitter",
    Icon: XIcon,
    blurb: "Add your Twitter followers",
    manual: {
      exportUrl: "https://x.com/settings/download_your_data",
      accept: "ZIP file accepted",
      acceptMime: ".zip,application/zip",
      guide: [{ text: "Request your archive on the next screen" }],
    },
  },
  {
    provider: "luma",
    name: "Luma",
    Icon: LumaIcon,
    blurb: "Add your Luma events and guests",
    manual: {
      exportUrl: "https://lu.ma/home",
      accept: "CSV file accepted",
      acceptMime: ".csv,text/csv",
      guide: [
        { text: "Open an event you host and go to the Guests tab" },
        { text: "Click Export and download the guest list as CSV" },
      ],
    },
  },
  {
    provider: "outlook",
    name: "Outlook",
    Icon: OutlookIcon,
    blurb: "Add your Outlook contacts",
    oauth: {
      privacy:
        "Connect your Outlook account to import your contacts. The requested permissions are contacts and your account's basic identity",
      buttonLabel: "Connect Outlook",
    },
  },
  {
    provider: "extension",
    name: "Chrome Extension",
    Icon: ChromeIcon,
    blurb: "Capture your LinkedIn mutual connections",
    extension: {
      downloadUrl: "/api/extension/download",
      intro:
        "Capture a LinkedIn profile and its mutual connections from profiles you open, on a click, in your own session",
      steps: [
        { text: "Download the Warmline extension and unzip it" },
        {
          text: "Open chrome://extensions and turn on Developer mode (top right)",
        },
        { text: "Click Load unpacked and select the unzipped folder" },
        {
          text: "Paste your Settings token, then click Capture on a profile",
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
    body: "We automatically find professional info, social profiles, and other public details about each person you share with us",
  },
  {
    Icon: ClockIcon,
    title: "Your imports show up right away",
    body: "An import starts building your feed as soon as it finishes. Ranking everyone fully against your goal continues on the daily run, so a large network keeps sharpening over a day or two",
  },
  {
    Icon: ShieldIcon,
    title: "Your data stays private",
    body: "We never share, sell, or use your data to train AI models. Only you can search your connections",
  },
  {
    Icon: InfoIcon,
    title: "We don't overshare",
    body: "We never reveal the contents or recency of your communications. You can delete your data at any time from Settings",
  },
];

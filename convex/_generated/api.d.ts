/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as avatars from "../avatars.js";
import type * as connectors from "../connectors.js";
import type * as crons from "../crons.js";
import type * as devSeed from "../devSeed.js";
import type * as edges from "../edges.js";
import type * as extension from "../extension.js";
import type * as feed from "../feed.js";
import type * as feedback from "../feedback.js";
import type * as graph from "../graph.js";
import type * as http from "../http.js";
import type * as icp from "../icp.js";
import type * as ingest from "../ingest.js";
import type * as lib from "../lib.js";
import type * as linkedinCsv from "../linkedinCsv.js";
import type * as linkedinImport from "../linkedinImport.js";
import type * as myFunctions from "../myFunctions.js";
import type * as onboard from "../onboard.js";
import type * as openai from "../openai.js";
import type * as rank from "../rank.js";
import type * as resolve from "../resolve.js";
import type * as seedDemo from "../seedDemo.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authz: typeof authz;
  avatars: typeof avatars;
  connectors: typeof connectors;
  crons: typeof crons;
  devSeed: typeof devSeed;
  edges: typeof edges;
  extension: typeof extension;
  feed: typeof feed;
  feedback: typeof feedback;
  graph: typeof graph;
  http: typeof http;
  icp: typeof icp;
  ingest: typeof ingest;
  lib: typeof lib;
  linkedinCsv: typeof linkedinCsv;
  linkedinImport: typeof linkedinImport;
  myFunctions: typeof myFunctions;
  onboard: typeof onboard;
  openai: typeof openai;
  rank: typeof rank;
  resolve: typeof resolve;
  seedDemo: typeof seedDemo;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

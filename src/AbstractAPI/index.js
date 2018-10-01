// @flow
/* global fetch */
import "isomorphic-fetch";
import queryString from "query-string";
import find from "lodash/find";
import { fileCommitDescriptor, pageFileDescriptor } from "../utils";
import { log } from "../debug";
import type {
  AbstractInterface,
  ProjectDescriptor,
  BranchDescriptor,
  PageDescriptor,
  FileDescriptor,
  LayerDescriptor,
  CollectionDescriptor
} from "../";
import randomTraceId from "./randomTraceId";

const logStatusError = log.extend("AbstractAPI:status:error");
const logStatusSuccess = log.extend("AbstractAPI:status:success");
const logFetch = log.extend("AbstractAPI:fetch");

type Options = {
  abstractToken: string
};

async function unwrapEnvelope<T>(
  response: Promise<{
    data: T,
    policies: *
  }>
): Promise<T> {
  return (await response).data;
}

export default class AbstractAPI implements AbstractInterface {
  abstractToken: string;

  constructor({ abstractToken }: Options) {
    this.abstractToken = abstractToken;
  }

  async fetch(input: string | URL, init?: Object = {}) {
    init.headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.abstractToken}`,
      "X-Amzn-Trace-Id": randomTraceId(),
      ...(init.headers || {})
    };

    if (init.body) {
      init.body = JSON.stringify(init.body);
    }

    const fetchArgs = [
      `${process.env.ABSTRACT_API_URL ||
        "https://api.goabstract.com"}/${input.toString()}`,
      init
    ];

    logFetch(fetchArgs);
    const request = fetch(...fetchArgs);
    const response = await request;

    if (response.status < 200 || response.status >= 300) {
      if (logStatusError.enabled) {
        logStatusError(
          await response.clone().json() // Clone the response as response.body can only be used once
        );
      }

      throw new Error(`Received status "${response.status}", expected 2XX`);
    }

    if (logStatusSuccess.enabled) {
      logStatusSuccess(await response.clone().json());
    }

    return request;
  }

  commits = {
    list: async (
      objectDescriptor: BranchDescriptor | FileDescriptor | LayerDescriptor
    ) => {
      const query = queryString.stringify({
        fileId: objectDescriptor.fileId ? objectDescriptor.fileId : undefined,
        layerId: objectDescriptor.layerId ? objectDescriptor.layerId : undefined
      });

      const response = await this.fetch(
        // prettier-ignore
        `projects/${objectDescriptor.projectId}/branches/${objectDescriptor.branchId}/commits?${query}`,
        { headers: { "Abstract-Api-Version": "2" } }
      );

      return unwrapEnvelope(response.json());
    },
    info: async (
      objectDescriptor: BranchDescriptor | FileDescriptor | LayerDescriptor
    ) => {
      const { commits } = await this.commits.list(objectDescriptor);
      return commits[0];
    }
  };

  files = {
    list: async (branchDescriptor: BranchDescriptor) => {
      const response = await this.fetch(
        // prettier-ignore
        `projects/${branchDescriptor.projectId}/branches/${branchDescriptor.branchId}/files`
      );

      return unwrapEnvelope(response.json());
    },
    info: async (fileDescriptor: FileDescriptor) => {
      const { files } = await this.files.list(
        fileCommitDescriptor(fileDescriptor)
      );

      return find(files, { id: fileDescriptor.fileId });
    }
  };

  pages = {
    list: async (fileOrBranchDescriptor: FileDescriptor) => {
      const response = await this.fetch(
        // prettier-ignore
        `projects/${fileOrBranchDescriptor.projectId}/branches/${fileOrBranchDescriptor.branchId}/files/${fileOrBranchDescriptor.fileId}/pages`
      );

      return unwrapEnvelope(response.json());
    },
    info: async (pageDescriptor: PageDescriptor) => {
      const { pages } = await this.files.info(
        pageFileDescriptor(pageDescriptor)
      );

      return find(pages, { id: pageDescriptor.pageId });
    }
  };

  layers = {
    list: async (
      fileDescriptor: FileDescriptor,
      options: { pageId?: string, limit?: number, offset?: number } = {}
    ) => {
      const query = queryString.stringify(options);
      const response = await this.fetch(
        // prettier-ignore
        `projects/${fileDescriptor.projectId}/branches/${fileDescriptor.branchId}/files/${fileDescriptor.fileId}/layers?${query}`,
        { headers: { "Abstract-Api-Version": "2" } }
      );

      return unwrapEnvelope(response.json());
    },
    info: async (layerDescriptor: LayerDescriptor) => {
      const response = await this.fetch(
        // prettier-ignore
        `projects/${layerDescriptor.projectId}/branches/${layerDescriptor.branchId}/commits/${layerDescriptor.sha}/files/${layerDescriptor.fileId}/layers/${layerDescriptor.layerId}`,
        { headers: { "Abstract-Api-Version": "2" } }
      );

      return unwrapEnvelope(response.json());
    }
  };

  data = {
    layer: (layerDescriptor: LayerDescriptor) => {
      return this.fetch(
        // prettier-ignore
        `projects/${layerDescriptor.projectId}/branches/${layerDescriptor.branchId}/commits/${layerDescriptor.sha}/files/${layerDescriptor.fileId}/layers/${layerDescriptor.layerId}/data`
      );
    }
  };

  collections = {
    list: async (
      projectOrBranchDescriptor: ProjectDescriptor | BranchDescriptor,
      options?: { layersPerCollection?: number | "all" } = {}
    ) => {
      const query = queryString.stringify({
        branch_id: projectOrBranchDescriptor.branchId
          ? projectOrBranchDescriptor.branchId
          : undefined,
        ...options
      });

      const response = await this.fetch(
        // prettier-ignore
        `projects/${projectOrBranchDescriptor.projectId}/collections?${query}`,
        { headers: { "Abstract-Api-Version": "7" } } // TODO: No header should be the latest version?
      );

      return unwrapEnvelope(response.json());
    },
    info: async (
      collectionDescriptor: CollectionDescriptor,
      options?: { layersPerCollection?: number | "all" } = {}
    ) => {
      const query = queryString.stringify(options);
      const response = await this.fetch(
        // prettier-ignore
        `projects/${collectionDescriptor.projectId}/collections/${collectionDescriptor.collectionId}?${query}`,
        { headers: { "Abstract-Api-Version": "7" } }
      );

      return unwrapEnvelope(response.json());
    }
  };
}

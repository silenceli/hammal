import { TokenProvider } from './token'
import { Backend } from './backend'

const PROXY_HEADER_ALLOW_LIST: string[] = ["accept", "user-agent", "accept-encoding"]

const validActionNames = new Set(["manifests", "blobs", "tags", "referrers"])

const ORG_NAME_BACKEND:{ [key: string]: string; } = {
  "gcr.io": "https://gcr.io",
  "k8s.gcr.io": "https://k8s.gcr.io",
  "quay.io": "https://quay.io",
  "docker.io": "https://registry-1.docker.io",
  "ghcr.io": "https://ghcr.io",
  "nvcr.io": "https://nvcr.io"
}

const DEFAULT_BACKEND_HOST: string = "https://registry-1.docker.io"

export async function handleRequest(request: Request): Promise<Response> {
  return handleRegistryRequest(request)
}

function copyProxyHeaders(inputHeaders: Headers) : Headers {
  const headers = new Headers;
  for(const pair of inputHeaders.entries()) {
    if (pair[0].toLowerCase() in PROXY_HEADER_ALLOW_LIST) {
      headers.append(pair[0], pair[1])
    }
  }
  return headers
}

function orgNameFromPath(pathname: string): string|null {
  let splitedPath = pathname.split("/");

  // /v2/gcr.io/yyyy/repo/manifests/xxx
  if (splitedPath.length === 7 && splitedPath[0] === "" && splitedPath[1] === "v2") {
    return splitedPath[2].toLowerCase()
  }
  // const splitedPath: string[] = pathname.split("/", 3)
  // if (splitedPath.length === 3 && splitedPath[0] === "" && splitedPath[1] === "v2") {
  //   return splitedPath[2].toLowerCase()
  // }
  return null
}

function hostByOrgName(orgName: string|null): string {
  if (orgName !== null && orgName in ORG_NAME_BACKEND) {
    return ORG_NAME_BACKEND[orgName]
  }

  return DEFAULT_BACKEND_HOST
}

function rewritePath(orgName: string | null, pathname: string): string {
  let splitedPath = pathname.split("/");
  /*
    case 1: (without docker.io without library)
    /v2/repo/manifests/xxx -> /v2/library/repo/manifests/xxx
    /v2/repo/blobs/xxx -> /v2/library/repo/blobs/xxx

    case 2: (with docker.io without library)
    /v2/docker.io/repo/manifests/xxx -> /v2/library/repo/manifests/xxx
    /v2/docker.io/repo/blobs/xxx -> /v2/library/repo/blobs/xxx

    case 3: (without docker.io with library)
    /v2/library/repo/manifests/xxx -> /v2/library/repo/manifests/xxx

    case 4: (with docker.io with library)
    /v2/docker.io/library/repo/blobs/xxx -> /v2/library/repo/blobs/xxx

    case 5: other
    /v2/gcr.io/library/repo/blobs/xxx -> /v2/library/repo/blobs/xxx
  */
  if (orgName === null && splitedPath.length === 5 && validActionNames.has(splitedPath[3])) {
    // case 1
    splitedPath = [splitedPath[0], splitedPath[1], "library", splitedPath[2], splitedPath[3], splitedPath[4]]
  } else if (orgName === null && splitedPath.length === 6 && validActionNames.has(splitedPath[4])) {
    // case3
    ;
  } else if (orgName === "docker.io" && splitedPath.length === 6 && validActionNames.has(splitedPath[4])) {
    // case 2
    splitedPath = [splitedPath[0], splitedPath[1], "library", splitedPath[3], splitedPath[4], splitedPath[5]]
  } else if (orgName !== null && splitedPath.length === 7) {
    // case 4 & case 5
    splitedPath = [splitedPath[0], splitedPath[1], splitedPath[3], splitedPath[4], splitedPath[5], splitedPath[6]]
  }


  return splitedPath.join("/")
}

async function handleRegistryRequest(request: Request): Promise<Response> {
  const reqURL = new URL(request.url)
  const orgName = orgNameFromPath(reqURL.pathname)
  const pathname = rewritePath(orgName, reqURL.pathname)
  /*
    proxy.foo.bar/gcr.io/ml-pipeline/frontend:2.0.0-alpha.7
    proxy.foo.bar/quay.io/jetstack/cert-manager-webhook:v1.10.1
    proxy.foo.bar/docker.io/kubeflownotebookswg/tensorboards-web-app:v1.7.0
    proxy.foo.bar/kubeflownotebookswg/jupyter-tensorflow-cuda-full:v1.7.0
    proxy.foo.bar/kubeflownotebookswg/tensorboards-web-app:v1.7.0
  */
  const host = hostByOrgName(orgName)
  const tokenProvider = new TokenProvider()
  const backend = new Backend(host, tokenProvider)
  const headers = copyProxyHeaders(request.headers)
  return backend.proxy(pathname, {headers: request.headers})
}

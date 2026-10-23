const manifestSources = (branch, migrated = false) => {
  const base = `https://raw.githubusercontent.com/commaai/openpilot/${branch}`
  const legacy = `${base}/system/hardware/tici/all-partitions.json`
  const current = `${base}/openpilot/common/hardware/comma/all-partitions.json`
  // Releases migrate independently. Always stay on the selected device's branch.
  return migrated ? [current, legacy] : [legacy, current]
}

const config = {
  manifests: {
    release_mici: manifestSources('release-mici'),
    release_tizi: manifestSources('release-tizi', true),
    release_tici: manifestSources('release-tici'),
  },
  loader: {
    url: 'https://raw.githubusercontent.com/commaai/flash/master/src/QDL/programmer.bin',
  },
}

export default config

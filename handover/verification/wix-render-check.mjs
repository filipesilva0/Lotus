import Handlebars from 'handlebars';
import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

const tpl = fs.readFileSync('src-tauri/wix/main.wxs', 'utf8');
const data = {
  product_name: 'Lotus', manufacturer: 'Lotus', version: '0.1.0', upgrade_code: '6f4a7c52-3b1e-4f0a-9d8c-2a5e7b91c4d3',
  path_component_guid: 'aaaaaaaa-0000-4000-8000-000000000001', main_binary_path: 'C:\\t\\lotus.exe', icon_path: 'C:\\t\\icon.ico',
  license: 'C:\\t\\license.rtf', homepage: 'https://example.com', bundle_id: 'app.lotus.studio',
  binaries: [], resources: {}, resource_file_ids: [], resource_dir_ids: [], merge_modules: [], deep_link_protocols: [],
  install_webview: true, webview_installer_args: '/silent', minimum_webview2_version: '110.0.0.0', enable_elevated_update_task: false,
  banner_path: 'C:\\t\\banner.bmp', dialog_image_path: 'C:\\t\\dialog.bmp', download_bootstrapper: true, webview: true, dialog_image_path_: undefined,
};
const out = Handlebars.compile(tpl, { noEscape: true })(data);
fs.writeFileSync('/tmp/rendered.wxs', out);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', preserveOrder: false, processEntities: false });
const doc = parser.parse(out); // throws on malformed XML

const ids = (re) => [...out.matchAll(re)].map((m) => m[1]);
const compDefs = ids(/<Component\s+Id="([^"]+)"/g), compRefs = ids(/<ComponentRef\s+Id="([^"]+)"/g);
const dirDefs = ids(/<Directory\s+Id="([^"]+)"/g), dirRefs = ids(/<DirectoryRef\s+Id="([^"]+)"/g);
const featDefs = ids(/<Feature\s+Id="([^"]+)"/g);
const dup = (a) => a.filter((x, i) => a.indexOf(x) !== i);
console.log('XML parsed OK; root:', Object.keys(doc).filter((k) => !k.startsWith('?')).join(','));
console.log('components:', compDefs.join(', '));
console.log('features:', featDefs.join(', '));
console.log('undefined ComponentRefs:', compRefs.filter((r) => !compDefs.includes(r)));
console.log('components not in any feature:', compDefs.filter((c) => !compRefs.includes(c)));
console.log('undefined DirectoryRefs:', dirRefs.filter((r) => !dirDefs.includes(r) && !['TARGETDIR','DesktopFolder','ProgramMenuFolder','WixPerUserFolder'].includes(r)));
console.log('duplicate component ids:', dup(compDefs), ' duplicate dir ids:', dup(dirDefs));
console.log('UI:', ids(/<UIRef\s+Id="([^"]+)"/g).join(','), '| scope props:', ['ALLUSERS','MSIINSTALLPERUSER','WixAppFolder','ApplicationFolderName'].map((p)=>out.includes(`Id="${p}"`)).join(','));
console.log('leftover INSTALLDIR refs:', (out.match(/INSTALLDIR/g) || []).length, '| leftover WixUI_InstallDir:', out.includes('WixUI_InstallDir'));
// Session 10: per-user install into Documents\Lotus Studio, custom Engines/Options pages.
const stock = ['WelcomeDlg','LicenseAgreementDlg','InstallDirDlg','VerifyReadyDlg','BrowseDlg','ExitDialog','MaintenanceWelcomeDlg','MaintenanceTypeDlg','CancelDlg','InvalidDirDlg'];
const dlgDefs = ids(/<Dialog\s+Id="([^"]+)"/g);
const published = [...out.matchAll(/<Publish\s+Dialog="([^"]+)"[^>]*?(?:Value="([^"]+)")?/g)].flatMap((m) => [m[1]]);
const targets = [...out.matchAll(/Event="(?:NewDialog|SpawnDialog)"\s+Value="([^"]+)"/g)].map((m) => m[1]);
console.log('custom dialogs:', dlgDefs.join(', '), '| unknown dialogs referenced:', [...new Set([...published, ...targets])].filter((d) => !dlgDefs.includes(d) && !stock.includes(d)));
const fileKeyPaths = [...out.matchAll(/<File\s[^>]*KeyPath="yes"/g)].length;
const hkmu = (out.match(/Root="HKMU"|Root="HKLM" Key="Software\\Classes/g) || []).length;
console.log('file key paths (must be 0 for a per-user folder):', fileKeyPaths, '| HKMU/HKLM class keys (must be 0):', hkmu);
console.log('install folder:', /<Directory Id="PersonalFolder">\s*<Directory Id="APPLICATIONFOLDER" Name="Lotus Studio"\/>/.test(out) ? 'Documents\\Lotus Studio' : 'NOT Documents');
console.log('scope:', /InstallScope="perUser"/.test(out) && /InstallPrivileges="limited"/.test(out) ? 'per-user, no elevation' : 'CHECK');
console.log('doubled backslashes outside placeholders:', (out.match(/\\\\/g) || []).length);
const controlsWithProps = [...out.matchAll(/Property="([A-Z_]+)"\s+CheckBoxValue/g)].map((m) => m[1]);
console.log('check boxes bound to defined properties:', controlsWithProps.every((p) => out.includes(`<Property Id="${p}"`)), controlsWithProps.join(','));
console.log('engine searches:', ids(/<Property Id="([A-Z]+_FOUND)">/g).join(','), '| SetupEngines value:', /Name="SetupEngines"[^>]*Value="ollama=\[INSTALL_OLLAMA\];comfyui=\[INSTALL_COMFYUI\];voicebox=\[INSTALL_VOICEBOX\]"/.test(out));

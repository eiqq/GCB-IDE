# -*- coding: utf-8 -*-
"""vsce 없이 .vsix 만들기.  python pack.py  ->  gcb-skript-<ver>.vsix

.vsix 는 그냥 zip 이다: extension/ + extension.vsixmanifest + [Content_Types].xml
설치: code --install-extension gcb-skript-<ver>.vsix --force
주의: 이 폴더를 .vscode\\extensions 안에 두지 말 것 (설치 시 소스가 지워진다).
"""
import json, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = json.load(open(os.path.join(HERE, 'package.json'), encoding='utf-8'))
INCLUDE = ['package.json', 'extension.js', 'language-configuration.json',
           'syntaxes/skript.tmLanguage.json', 'README.md']

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
	<Metadata>
		<Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}" />
		<DisplayName>{display}</DisplayName>
		<Description xml:space="preserve">{desc}</Description>
		<Categories>Programming Languages</Categories>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}" />
		</Properties>
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code" />
	</Installation>
	<Dependencies />
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
	</Assets>
</PackageManifest>
"""

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension=".json" ContentType="application/json" />
	<Default Extension=".js" ContentType="application/javascript" />
	<Default Extension=".md" ContentType="text/markdown" />
	<Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
"""

out = os.path.join(HERE, '%s-%s.vsix' % (PKG['name'], PKG['version']))
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('extension.vsixmanifest', MANIFEST.format(
        name=PKG['name'], version=PKG['version'], publisher=PKG['publisher'],
        display=PKG['displayName'], desc=PKG['description'],
        engine=PKG['engines']['vscode']))
    z.writestr('[Content_Types].xml', CONTENT_TYPES)
    for f in INCLUDE:
        z.write(os.path.join(HERE, f), 'extension/' + f)
print(out)

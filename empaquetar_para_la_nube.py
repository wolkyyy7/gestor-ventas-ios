import os
import sys
import zipfile

if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def create_deploy_zip():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    output_zip = os.path.join(base_dir, "gestor-ventas-ios.zip")
    root_zip = os.path.join(os.path.dirname(base_dir), "gestor-ventas-ios.zip")

    # Archivos que componen la aplicación cliente PWA
    allowed_extensions = ('.html', '.js', '.css', '.json', '.png', '.svg', '.webmanifest')

    print("Empaquetando aplicacion para despliegue en la nube (PWA)...")

    files_added = []
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(base_dir):
            if '__pycache__' in root:
                continue

            for file in files:
                if file.endswith(allowed_extensions) and not file.startswith('test_'):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, base_dir)
                    zipf.write(full_path, rel_path)
                    files_added.append(rel_path)

    # Copiar también a la raíz de Antigravity para fácil acceso
    try:
        import shutil
        shutil.copy2(output_zip, root_zip)
    except Exception:
        pass

    print(f"\n[OK] Archivo ZIP generado con exito:")
    print(f"  -> {output_zip}")
    print(f"  -> {root_zip}")
    print(f"\nTotal de archivos empaquetados: {len(files_added)}")
    for f in files_added:
        print(f"  - {f}")

if __name__ == '__main__':
    create_deploy_zip()

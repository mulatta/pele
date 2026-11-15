{
  description = "pele: Mermaid diagrams to SVG and vector scenes";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      treefmt-nix,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      inherit (nixpkgs) lib;

      eachSystem = lib.genAttrs systems;

      pkgsFor = eachSystem (system: import nixpkgs { inherit system; });

      treefmtEval = eachSystem (
        system:
        treefmt-nix.lib.evalModule pkgsFor.${system} {
          projectRootFile = "flake.nix";
          programs = {
            deadnix.enable = true;
            nixfmt.enable = true;
            statix.enable = true;
          };
        }
      );
    in
    {
      packages = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
          # CI and package.json's engines build with Node 24.
          buildNpmPackage = pkgs.buildNpmPackage.override { nodejs = pkgs.nodejs_24; };
        in
        {
          default = buildNpmPackage {
            pname = "pele";
            inherit ((lib.importJSON ./package.json)) version;
            # What the library build and its tests read; the website has dependencies of its own.
            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions [
                ./package.json
                ./package-lock.json
                ./tsconfig.json
                ./vitest.config.ts
                ./scripts
                ./src
                (lib.fileset.difference ./tests ./tests/website)
                ./LICENSE
                ./README.md
              ];
            };
            npmDepsHash = "sha256-AXLKwNzyEKggUhcd6lILvTvComquC6ODTKvffIHjarc=";
            # The library tests as CI runs them, from the locked dependencies.
            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm test -- --maxWorkers="$NIX_BUILD_CORES" --exclude '**/stress.test.ts'
              # Stress budgets assume upstream's two-core CI, so run them apart from the rest.
              npm test -- --maxWorkers=2 stress.test
              runHook postCheck
            '';
            meta = {
              description = "Mermaid diagrams to SVG and vector scenes";
              license = lib.licenses.mit;
            };
          };
        }
      );

      devShells = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              # The same major version package.json pins, for `tsc` without npx.
              pkgs.typescript
            ];
          };
        }
      );

      checks = eachSystem (system: {
        build = self.packages.${system}.default;
        formatting = treefmtEval.${system}.config.build.check self;
      });

      formatter = eachSystem (system: treefmtEval.${system}.config.build.wrapper);
    };
}

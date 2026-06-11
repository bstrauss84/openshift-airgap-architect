const path = require('path');
const { ConsoleRemotePlugin } = require('@openshift-console/dynamic-plugin-sdk-webpack');

module.exports = {
  mode: 'development',
  entry: './src/plugin.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-bundle.js',
    chunkFilename: '[name]-chunk.js',
    publicPath: 'auto'
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  module: {
    rules: [
      {
        test: /\.(jsx?|tsx?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new ConsoleRemotePlugin({
      pluginMetadata: {
        name: 'airgap-architect-plugin',
        version: '1.0.0',
        displayName: 'Airgap Architect',
        description: 'OpenShift Airgap Architect Console Plugin',
        exposedModules: {
          pages: './src/pages/index.ts'
        }
      }
    })
  ],
  devServer: {
    port: 9001,
    static: {
      directory: path.join(__dirname, 'dist')
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization'
    }
  },
  devtool: 'source-map'
};
